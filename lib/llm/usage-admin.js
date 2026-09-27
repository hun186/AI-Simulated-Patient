import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../authz.js';
import { resolveFxRate } from './fx.js';

function fail(code,message=code){
  const error=new Error(message);
  error.code=code;
  return error;
}

function positiveFxMicrounits(value){
  const number=Number(value);
  if(!Number.isFinite(number) || number<=0) throw fail('INVALID_FX_RATE');
  return Math.round(number*1000000);
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


function isoFilter(value,code){
  if(value===null||value===undefined||value==='') return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) throw fail(code);
  return date.toISOString();
}

function usageFilterState(input={}){
  const from=isoFilter(input.from,'INVALID_USAGE_FROM');
  const to=isoFilter(input.to,'INVALID_USAGE_TO');
  if(from&&to&&from>=to) throw fail('INVALID_USAGE_RANGE');
  const outcome=String(input.outcome||'all');
  if(!['all','success','failure'].includes(outcome)) throw fail('INVALID_USAGE_OUTCOME');
  const cacheStatus=String(input.cacheStatus||'all');
  if(!['all','reported','unreported'].includes(cacheStatus)) throw fail('INVALID_CACHE_STATUS');
  const offset=Number(input.timeZoneOffsetMinutes||0);
  if(!Number.isFinite(offset)||offset<-840||offset>840) throw fail('INVALID_TIMEZONE_OFFSET');
  return {
    from,to,outcome,cacheStatus,timeZoneOffsetMinutes:Math.trunc(offset),
    provider:String(input.provider||'').trim(),
    model:String(input.model||'').trim(),
    agentType:String(input.agentType||'').trim(),
    caseId:String(input.caseId||'').trim()
  };
}

function usageWhere(ids,filters,{facets=false}={}){
  const params=[...ids];
  const placeholders=ids.map((_,i)=>'$'+(i+1)).join(',');
  let where=`e.user_id in (${placeholders})`;
  const add=(clause,value)=>{
    params.push(value);
    where+=' and '+clause.replace('?', '$'+params.length);
  };
  if(filters.from)add('e.created_at >= ?',filters.from);
  if(filters.to)add('e.created_at < ?',filters.to);
  if(!facets){
    if(filters.provider)add('e.preset = ?',filters.provider);
    if(filters.model)add('e.model = ?',filters.model);
    if(filters.agentType)add('e.agent_type = ?',filters.agentType);
    if(filters.caseId)add('e.case_id = ?',filters.caseId);
    if(filters.outcome==='success')add('e.success = ?',true);
    if(filters.outcome==='failure')add('e.success = ?',false);
    if(filters.cacheStatus!=='all')add('e.cache_read_status = ?',filters.cacheStatus);
  }
  return {where,params};
}

const USAGE_METRICS=`
  count(*) as calls,
  coalesce(sum(case when e.usage_status in ('reported','estimated') then e.total_tokens else 0 end),0) as tokens,
  coalesce(sum(case when e.usage_status in ('reported','estimated') then e.input_tokens else 0 end),0) as "inputTokens",
  coalesce(sum(case when e.cache_read_status='reported' then e.input_tokens else 0 end),0) as "cacheReportedInputTokens",
  coalesce(sum(case when e.cache_read_status='reported' then e.cached_input_tokens else 0 end),0) as "cachedInputTokens",
  coalesce(sum(case when e.cache_read_status='reported' then e.cache_miss_tokens else 0 end),0) as "cacheMissTokens",
  sum(case when e.cache_read_status='reported' then 1 else 0 end) as "cacheReportedCalls",
  coalesce(sum(case when e.cache_savings_microusd is not null then e.cache_savings_microusd else 0 end),0) as "cacheSavingsMicrousd",
  coalesce(sum(case when e.cache_savings_microntd is not null then e.cache_savings_microntd else 0 end),0) as "cacheSavingsMicrontd",
  coalesce(sum(case when e.estimated_cost_microusd is not null then e.estimated_cost_microusd else 0 end),0) as "estimatedCostMicrousd",
  coalesce(sum(case when e.estimated_cost_microntd is not null then e.estimated_cost_microntd else 0 end),0) as "estimatedCostMicrontd",
  sum(case when e.pricing_status='unpriced' then 1 else 0 end) as "unpricedCalls",
  sum(case when e.pricing_status='partial' then 1 else 0 end) as "partialPricingCalls"
`;

function localUsageDate(value,timeZoneOffsetMinutes){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) return String(value||'').slice(0,10);
  return new Date(date.getTime()-timeZoneOffsetMinutes*60000).toISOString().slice(0,10);
}

function addMetric(target,row){
  for(const key of [
    'calls','tokens','inputTokens','cacheReportedInputTokens','cachedInputTokens','cacheMissTokens',
    'cacheReportedCalls','cacheSavingsMicrousd','cacheSavingsMicrontd',
    'estimatedCostMicrousd','estimatedCostMicrontd','unpricedCalls','partialPricingCalls'
  ]) target[key]=(target[key]||0)+Number(row[key]||0);
  return target;
}

function byLocalDate(rows,timeZoneOffsetMinutes){
  const map=new Map();
  for(const row of rows){
    const date=localUsageDate(row.createdAt,timeZoneOffsetMinutes);
    const current=map.get(date)||{date};
    addMetric(current,row);
    map.set(date,current);
  }
  return [...map.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}

export async function usageSummary(actor,input={}){
  const visible=await listVisibleUsageUsers(actor);
  const visibleIds=visible.map(u=>u.id);
  const filters=usageFilterState(input);
  if(input.userId && !visibleIds.includes(input.userId)) throw fail('FORBIDDEN');
  const ids=input.userId?[input.userId]:visibleIds;
  if(!ids.length){
    return {
      users:visible,totals:[],byDate:[],byProvider:[],byModel:[],byAgent:[],
      filters:{providers:[],models:[],agents:[],cases:[]},
      range:filters,fxRate:await resolveFxRate()
    };
  }

  const selected=usageWhere(ids,filters);
  const facetScope=usageWhere(ids,filters,{facets:true});
  const [totals,byProvider,byModel,byAgent,dateRows,providers,models,agents,cases]=await Promise.all([
    query(
      `select e.user_id as "userId",${USAGE_METRICS}
       from llm_usage_events e where ${selected.where}
       group by e.user_id order by e.user_id`,
      selected.params
    ),
    query(
      `select e.preset,${USAGE_METRICS}
       from llm_usage_events e where ${selected.where}
       group by e.preset order by e.preset`,
      selected.params
    ),
    query(
      `select e.model,${USAGE_METRICS}
       from llm_usage_events e where ${selected.where}
       group by e.model order by e.model`,
      selected.params
    ),
    query(
      `select e.agent_type as "agentType",${USAGE_METRICS}
       from llm_usage_events e where ${selected.where}
       group by e.agent_type order by e.agent_type`,
      selected.params
    ),
    query(
      `select e.created_at as "createdAt",${USAGE_METRICS}
       from llm_usage_events e where ${selected.where}
       group by e.id,e.created_at order by e.created_at desc`,
      selected.params
    ),
    query(
      `select distinct e.preset as value
       from llm_usage_events e where ${facetScope.where}
       order by e.preset`,
      facetScope.params
    ),
    query(
      `select distinct e.preset,e.model
       from llm_usage_events e where ${facetScope.where}
       order by e.preset,e.model`,
      facetScope.params
    ),
    query(
      `select distinct e.agent_type as value
       from llm_usage_events e where ${facetScope.where}
       order by e.agent_type`,
      facetScope.params
    ),
    query(
      `select distinct e.case_id as "caseId",
         coalesce(c.student_label,e.case_id) as label
       from llm_usage_events e
       left join cases c on c.id=e.case_id
       where ${facetScope.where} and e.case_id is not null
       order by label`,
      facetScope.params
    )
  ]);

  return {
    users:visible,totals,
    byDate:byLocalDate(dateRows,filters.timeZoneOffsetMinutes),
    byProvider,byModel,byAgent,
    filters:{
      providers:providers.map(row=>row.value),
      models:models.map(row=>({provider:row.preset,model:row.model})),
      agents:agents.map(row=>row.value),
      cases
    },
    range:filters,
    fxRate:await resolveFxRate()
  };
}

export async function listPricingRules(actor){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  return query(
    `select id,preset,model_pattern as "modelPattern",
     time_band as "timeBand",
     context_band as "contextBand",
     input_microusd_per_million as "inputMicrousdPerMillion",
     cached_input_microusd_per_million as "cachedInputMicrousdPerMillion",
     cache_write_microusd_per_million as "cacheWriteMicrousdPerMillion",
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
  const contextBand=String(input.contextBand||'any');
  if(!['any','short','long'].includes(contextBand)) throw fail('INVALID_CONTEXT_BAND');
  const id=randomUUID();
  const effectiveAt=input.effectiveAt?new Date(input.effectiveAt).toISOString():new Date().toISOString();
  await query(
    `insert into llm_pricing_rules
      (id,preset,model_pattern,time_band,context_band,input_microusd_per_million,cached_input_microusd_per_million,
       cache_write_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,preset,modelPattern,timeBand,contextBand,
      nullableLimit(input.inputMicrousdPerMillion),
      nullableLimit(input.cachedInputMicrousdPerMillion),
      nullableLimit(input.cacheWriteMicrousdPerMillion),
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


export async function getLatestUsdTwdRate(actor){
  if(!actor || ![ROLE_ADMIN,ROLE_TEACHER].includes(actor.role)) throw fail('FORBIDDEN');
  return resolveFxRate({baseCurrency:'USD',quoteCurrency:'TWD'});
}

export async function createUsdTwdRate(actor,input){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  const id=randomUUID();
  const rateMicrounits=positiveFxMicrounits(input.rate);
  const source=String(input.source||'Admin reference rate').trim().slice(0,240);
  const effectiveAt=input.effectiveAt?new Date(input.effectiveAt).toISOString():new Date().toISOString();
  await query(
    `insert into llm_fx_rates
      (id,base_currency,quote_currency,rate_microunits_per_unit,source,effective_at,is_active,created_by)
     values ($1,'USD','TWD',$2,$3,$4,true,$5)`,
    [id,rateMicrounits,source,effectiveAt,actor.id]
  );
  return resolveFxRate({baseCurrency:'USD',quoteCurrency:'TWD',at:effectiveAt});
}
