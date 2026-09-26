import { mockEvaluate } from '../lib/mock-evaluator.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,getTranscript,completeSession } from '../lib/server-sessions.js';
import { runEvaluatorAgent } from '../lib/llm/agents.js';
import { recordLlmUsage } from '../lib/llm/usage.js';
import { enforceLlmQuota } from '../lib/llm/quota.js';
import { isProductionEnv } from '../lib/request-security.js';

function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){try{return JSON.parse(value);}catch{return fallback;}}
  return value&&typeof value==='object'?value:fallback;
}
function providerFailure(res,error){
  if(error?.code==='AI_USAGE_QUOTA_EXCEEDED'){
    res.status(429).json({error:error.code,dimension:error.dimension});
    return true;
  }
  if(error?.code==='AI_PROVIDER_NOT_CONFIGURED'){
    res.status(503).json({error:'AI_EVALUATOR_PROVIDER_NOT_CONFIGURED'});
    return true;
  }
  if(error?.code==='timeout'){
    res.status(504).json({error:'AI_PROVIDER_TIMEOUT'});
    return true;
  }
  if(error?.code){
    res.status(502).json({error:'AI_PROVIDER_FAILURE',code:error.code});
    return true;
  }
  return false;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],mode='exam',sessionId=null}=req.body??{};
  try{
    if(!isDatabaseEnabled()) return res.status(200).json(mockEvaluate({caseId,caseDefinition,transcript,revealedFactIds,mode}));
    const user=await requireUser(req,res,['student','teacher','admin']);
    if(!user) return;
    if(!(await requireCsrf(req,res))) return;
    const session=await getOwnedSession(sessionId,user);
    if(!session) return res.status(404).json({error:'Session not found'});
    if(session.status!=='active') return res.status(409).json({error:'Session already finalized'});
    const serverTranscript=await getTranscript(sessionId);
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:parseJson(session.revealed_fact_ids,[]);
    const caseSnapshot=parseJson(session.case_snapshot,{});
    const routes=parseJson(session.llm_route_snapshot,{});
    const route=routes.evaluator||null;

    if(!isProductionEnv() && route?.preset==='mock'){
      const result=mockEvaluate({
        caseId:session.case_id,caseDefinition:caseSnapshot,transcript:serverTranscript,
        revealedFactIds:revealed,mode:session.mode
      });
      await completeSession(sessionId,result);
      return res.status(200).json(result);
    }

    try{await enforceLlmQuota({userId:user.id});}catch(error){if(providerFailure(res,error)) return;throw error;}
    const started=Date.now();
    try{
      const result=await runEvaluatorAgent({session,transcript:serverTranscript,route});
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'evaluator',route,result
      });
      await completeSession(sessionId,result.evaluation);
      return res.status(200).json(result.evaluation);
    }catch(error){
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'evaluator',route,error,
        latencyMs:Date.now()-started
      });
      const mapped=providerFailure(res,error);
      if(mapped) return mapped;
      throw error;
    }
  }catch(error){
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
