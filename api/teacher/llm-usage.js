import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser,requireCsrf } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';
import { recordAuthEvent } from '../../lib/auth-audit.js';
import {
  listVisibleUsageUsers,getQuota,setQuota,usageSummary,
  listPricingRules,createPricingRule,setPricingRuleActive
} from '../../lib/llm/usage-admin.js';

function statusFor(error){
  if(error?.code==='FORBIDDEN') return 403;
  if(['USER_NOT_FOUND','PRICING_RULE_NOT_FOUND'].includes(error?.code)) return 404;
  if(['INVALID_LIMIT','INVALID_PRESET','INVALID_TIME_BAND','MODEL_PATTERN_REQUIRED'].includes(error?.code)) return 400;
  return 500;
}

export default async function handler(req,res){
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor) return;

  try{
    if(req.method==='GET'){
      const action=String(req.query?.action||'summary');
      if(action==='users') return res.status(200).json({users:await listVisibleUsageUsers(actor),actorRole:actor.role});
      if(action==='quota'){
        const userId=String(req.query?.userId||actor.id);
        return res.status(200).json({quota:await getQuota(actor,userId)});
      }
      if(action==='pricing'){
        return res.status(200).json({rules:await listPricingRules(actor)});
      }
      const userId=req.query?.userId?String(req.query.userId):null;
      const from=req.query?.from?String(req.query.from):null;
      const to=req.query?.to?String(req.query.to):null;
      return res.status(200).json(await usageSummary(actor,{userId,from,to}));
    }

    if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    if(!(await requireCsrf(req,res))) return;
    const body=req.body??{};
    const action=String(body.action||'');

    if(action==='setQuota'){
      const quota=await setQuota(actor,String(body.userId||''),body);
      await recordAuthEvent({
        req,action:'llm.quota.set',success:true,reason:'updated',
        actorUserId:actor.id,targetUserId:body.userId,
        metadata:{dailyTokenLimit:quota.dailyTokenLimit,monthlyTokenLimit:quota.monthlyTokenLimit}
      });
      return res.status(200).json({quota});
    }
    if(action==='createPricingRule'){
      const rule=await createPricingRule(actor,body);
      await recordAuthEvent({
        req,action:'llm.pricing.create',success:true,reason:rule.preset,
        actorUserId:actor.id,metadata:{pricingRuleId:rule.id,modelPattern:rule.modelPattern}
      });
      return res.status(201).json({rule});
    }
    if(action==='setPricingRuleActive'){
      const rule=await setPricingRuleActive(actor,String(body.pricingRuleId||''),Boolean(body.isActive));
      await recordAuthEvent({
        req,action:'llm.pricing.toggle',success:true,reason:rule.isActive?'enabled':'disabled',
        actorUserId:actor.id,metadata:{pricingRuleId:rule.id}
      });
      return res.status(200).json({rule});
    }
    return res.status(400).json({error:'Unsupported action'});
  }catch(error){
    const status=statusFor(error);
    if(status===500) console.error(error);
    return res.status(status).json({error:status===500?'Unexpected error':error.code});
  }
}
