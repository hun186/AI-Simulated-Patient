import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../authz.js';

function fail(code,message=code){
  const error=new Error(message);
  error.code=code;
  return error;
}

function nullableLimit(value){
  if(value===null || value===undefined || value==='') return null;
  const number=Number(value);
  if(!Number.isFinite(number) || number<0) throw fail('INVALID_LIMIT');
  return Math.round(number);
}

async function assignedStudent(actor,userId){
  if(actor?.role!==ROLE_TEACHER) return false;
  const rows=await query(
    'select 1 from teacher_student_assignments where teacher_user_id=$1 and student_user_id=$2 limit 1',
    [actor.id,userId]
  );
  return Boolean(rows[0]);
}

export async function canViewUsageUser(actor,userId){
  if(actor?.role===ROLE_ADMIN) return true;
  if(actor?.role===ROLE_TEACHER) return actor.id===userId || await assignedStudent(actor,userId);
  return actor?.id===userId;
}

export async function canManageQuotaUser(actor,userId){
  if(actor?.role===ROLE_ADMIN) return true;
  return actor?.role===ROLE_TEACHER && actor.id!==userId && await assignedStudent(actor,userId);
}

export async function listVisibleUsageUsers(actor){
  if(actor?.role===ROLE_ADMIN){
    return query(
      `select id,email,display_name as "displayName",role,account_status as "accountStatus"
       from app_users order by display_name asc,email asc`
    );
  }
  if(actor?.role===ROLE_TEACHER){
    return query(
      `select distinct u.id,u.email,u.display_name as "displayName",u.role,u.account_status as "accountStatus"
       from app_users u
       where u.id=$1 or exists (
         select 1 from teacher_student_assignments a
         where a.teacher_user_id=$1 and a.student_user_id=u.id
       )
       order by u.display_name asc,u.email asc`,
      [actor.id]
    );
  }
  return query(
    `select id,email,display_name as "displayName",role,account_status as "accountStatus"
     from app_users where id=$1 limit 1`,
    [actor.id]
  );
}

export async function getQuota(actor,userId){
  if(!(await canViewUsageUser(actor,userId))) throw fail('FORBIDDEN');
  const rows=await query('select * from llm_user_quotas where user_id=$1 limit 1',[userId]);
  const q=rows[0]||null;
  return q?{
    userId:q.user_id,
    dailyTokenLimit:q.daily_token_limit,
    monthlyTokenLimit:q.monthly_token_limit,
    dailyCostLimitMicrousd:q.daily_cost_limit_microusd,
    monthlyCostLimitMicrousd:q.monthly_cost_limit_microusd,
    isActive:Boolean(q.is_active)
  }:null;
}

export async function setQuota(actor,userId,input){
  if(!(await canManageQuotaUser(actor,userId))) throw fail('FORBIDDEN');
  const found=(await query('select id from app_users where id=$1 limit 1',[userId]))[0];
  if(!found) throw fail('USER_NOT_FOUND');
  const values={
    dailyTokenLimit:nullableLimit(input.dailyTokenLimit),
    monthlyTokenLimit:nullableLimit(input.monthlyTokenLimit),
    dailyCostLimitMicrousd:nullableLimit(input.dailyCostLimitMicrousd),
    monthlyCostLimitMicrousd:nullableLimit(input.monthlyCostLimitMicrousd),
    isActive:input.isActive===undefined?true:Boolean(input.isActive)
  };
  await query(
    `insert into llm_user_quotas
      (user_id,daily_token_limit,monthly_token_limit,daily_cost_limit_microusd,monthly_cost_limit_microusd,is_active,updated_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (user_id) do update set
       daily_token_limit=excluded.daily_token_limit,
       monthly_token_limit=excluded.monthly_token_limit,
       daily_cost_limit_microusd=excluded.daily_cost_limit_microusd,
       monthly_cost_limit_microusd=excluded.monthly_cost_limit_microusd,
       is_active=excluded.is_active,
       updated_by=excluded.updated_by,
       updated_at=now()`,
    [userId,values.dailyTokenLimit,values.monthlyTokenLimit,values.dailyCostLimitMicrousd,values.monthlyCostLimitMicrousd,values.isActive,actor.id]
  );
  return getQuota(actor,userId);
}

export async function usageSummary(actor,{userId=null,from=null,to=null}={}){
  const visible=await listVisibleUsageUsers(actor);
  const visibleIds=visible.map(u=>u.id);
  if(userId && !visibleIds.includes(userId)) throw fail('FORBIDDEN');
  const ids=userId?[userId]:visibleIds;
  if(!ids.length) return {users:visible,totals:[],byDate:[],byProvider:[],byModel:[],byAgent:[]};

  const placeholders=ids.map((_,i)=>'$'+(i+1)).join(',');
  const params=[...ids];
  let where=`user_id in (${placeholders})`;
  if(from){params.push(from);where+=' and created_at >= $'+params.length;}
  if(to){params.push(to);where+=' and created_at < $'+params.length;}

  const [totals,byDate,byProvider,byModel,byAgent]=await Promise.all([
    query(
      `select user_id as "userId",count(*) as calls,
       coalesce(sum(case when usage_status in ('reported','estimated') then total_tokens else 0 end),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd",
       sum(case when pricing_status='unpriced' then 1 else 0 end) as "unpricedCalls",
       sum(case when pricing_status='partial' then 1 else 0 end) as "partialPricingCalls"
       from llm_usage_events where ${where} group by user_id order by user_id`,
      params
    ),
    query(
      `select date(created_at) as date,count(*) as calls,coalesce(sum(total_tokens),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd"
       from llm_usage_events where ${where} group by date(created_at) order by date(created_at) desc`,
      params
    ),
    query(
      `select preset,count(*) as calls,coalesce(sum(total_tokens),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd"
       from llm_usage_events where ${where} group by preset order by preset`,
      params
    ),
    query(
      `select model,count(*) as calls,coalesce(sum(total_tokens),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd"
       from llm_usage_events where ${where} group by model order by model`,
      params
    ),
    query(
      `select agent_type as "agentType",count(*) as calls,coalesce(sum(total_tokens),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd"
       from llm_usage_events where ${where} group by agent_type order by agent_type`,
      params
    )
  ]);
  return {users:visible,totals,byDate,byProvider,byModel,byAgent};
}

export async function listPricingRules(actor){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  return query(
    `select id,preset,model_pattern as "modelPattern",
     time_band as "timeBand",
     input_microusd_per_million as "inputMicrousdPerMillion",
     cached_input_microusd_per_million as "cachedInputMicrousdPerMillion",
     output_microusd_per_million as "outputMicrousdPerMillion",
     reasoning_microusd_per_million as "reasoningMicrousdPerMillion",
     effective_at as "effectiveAt",is_active as "isActive"
     from llm_pricing_rules order by preset,model_pattern,effective_at desc`
  );
}

export async function createPricingRule(actor,input){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  const preset=String(input.preset||'');
  if(!['openai','deepseek','ollama','custom'].includes(preset)) throw fail('INVALID_PRESET');
  const modelPattern=String(input.modelPattern||'').trim();
  if(!modelPattern) throw fail('MODEL_PATTERN_REQUIRED');
  const timeBand=String(input.timeBand||'always');
  if(!['always','peak','off_peak'].includes(timeBand)) throw fail('INVALID_TIME_BAND');
  const id=randomUUID();
  const effectiveAt=input.effectiveAt?new Date(input.effectiveAt).toISOString():new Date().toISOString();
  await query(
    `insert into llm_pricing_rules
      (id,preset,model_pattern,time_band,input_microusd_per_million,cached_input_microusd_per_million,
       output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,preset,modelPattern,timeBand,
      nullableLimit(input.inputMicrousdPerMillion),
      nullableLimit(input.cachedInputMicrousdPerMillion),
      nullableLimit(input.outputMicrousdPerMillion),
      nullableLimit(input.reasoningMicrousdPerMillion),
      effectiveAt,input.isActive===undefined?true:Boolean(input.isActive),actor.id
    ]
  );
  return (await listPricingRules(actor)).find(r=>r.id===id);
}

export async function setPricingRuleActive(actor,id,isActive){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  const rows=await query('select id from llm_pricing_rules where id=$1 limit 1',[id]);
  if(!rows[0]) throw fail('PRICING_RULE_NOT_FOUND');
  await query('update llm_pricing_rules set is_active=$2,updated_at=now() where id=$1',[id,Boolean(isActive)]);
  return {id,isActive:Boolean(isActive)};
}
