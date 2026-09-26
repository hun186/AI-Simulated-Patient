import { query } from '../db.js';

function quotaError(dimension,limit,used){
  const error=new Error('AI_USAGE_QUOTA_EXCEEDED');
  error.code='AI_USAGE_QUOTA_EXCEEDED';
  error.dimension=dimension;
  error.limit=Number(limit);
  error.used=Number(used);
  return error;
}

function utcBoundaries(now=new Date()){
  const date=now instanceof Date?now:new Date(now);
  const year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate();
  const dayStart=new Date(Date.UTC(year,month,day)).toISOString();
  const nextDay=new Date(Date.UTC(year,month,day+1)).toISOString();
  const monthStart=new Date(Date.UTC(year,month,1)).toISOString();
  const nextMonth=new Date(Date.UTC(year,month+1,1)).toISOString();
  return {dayStart,nextDay,monthStart,nextMonth};
}

async function sums(userId,start,end){
  const rows=await query(
    `select
       coalesce(sum(case when usage_status in ('reported','estimated') then total_tokens else 0 end),0) as tokens,
       coalesce(sum(case when estimated_cost_microusd is not null then estimated_cost_microusd else 0 end),0) as cost
     from llm_usage_events
     where user_id=$1 and created_at >= $2 and created_at < $3`,
    [userId,start,end]
  );
  const row=rows[0]||{};
  return {tokens:Number(row.tokens||0),cost:Number(row.cost||0)};
}

export async function getUserQuota(userId){
  if(!userId) return null;
  const rows=await query('select * from llm_user_quotas where user_id=$1 and is_active=true limit 1',[userId]);
  return rows[0]||null;
}

export async function getUsageAgainstQuota(userId,{now=new Date()}={}){
  const quota=await getUserQuota(userId);
  if(!quota) return {quota:null,daily:{tokens:0,cost:0},monthly:{tokens:0,cost:0}};
  const {dayStart,nextDay,monthStart,nextMonth}=utcBoundaries(now);
  const [daily,monthly]=await Promise.all([
    sums(userId,dayStart,nextDay),
    sums(userId,monthStart,nextMonth)
  ]);
  return {quota,daily,monthly};
}

export async function enforceLlmQuota({userId,now=new Date()}){
  const state=await getUsageAgainstQuota(userId,{now});
  const q=state.quota;
  if(!q) return state;

  const checks=[
    ['daily_tokens',q.daily_token_limit,state.daily.tokens],
    ['monthly_tokens',q.monthly_token_limit,state.monthly.tokens],
    ['daily_cost',q.daily_cost_limit_microusd,state.daily.cost],
    ['monthly_cost',q.monthly_cost_limit_microusd,state.monthly.cost]
  ];
  for(const [dimension,limit,used] of checks){
    if(limit!=null && Number(used)>=Number(limit)) throw quotaError(dimension,limit,used);
  }
  return state;
}
