import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';

function migrationFiles(projectRoot){
  const directory=join(projectRoot,'db','migrations');
  return readdirSync(directory)
    .map(name=>{
      const match=/^(\d+)_.*\.sql$/.exec(name);
      return match?{name,version:Number(match[1])}:null;
    })
    .filter(Boolean)
    .sort((a,b)=>a.version-b.version);
}

function tableExists(db,name){
  return Boolean(
    db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name)
  );
}

function columnExists(db,table,column){
  if(!tableExists(db,table)) return false;
  return db.pragma('table_info('+table+')').some(row=>row.name===column);
}

export function reconcileSqliteMigrationVersion(db,currentVersion=null){
  const recorded=Number(
    currentVersion===null
      ? db.pragma('user_version',{simple:true})
      : currentVersion
  )||0;
  let inferred=recorded;

  const hasV2=
    tableExists(db,'llm_provider_connections') &&
    tableExists(db,'llm_agent_routes') &&
    tableExists(db,'llm_usage_events') &&
    columnExists(db,'interview_sessions','llm_route_snapshot');
  if(hasV2) inferred=Math.max(inferred,2);

  const hasV3=hasV2 && columnExists(db,'llm_usage_events','usage_status');
  if(hasV3) inferred=Math.max(inferred,3);

  const hasV4=
    hasV3 &&
    tableExists(db,'llm_pricing_rules') &&
    tableExists(db,'llm_user_quotas') &&
    columnExists(db,'llm_usage_events','estimated_cost_microusd') &&
    columnExists(db,'llm_usage_events','pricing_status') &&
    columnExists(db,'llm_usage_events','pricing_rule_id');
  if(hasV4) inferred=Math.max(inferred,4);

  const hasV5=hasV4 && columnExists(db,'llm_agent_routes','owner_user_id');
  if(hasV5) inferred=Math.max(inferred,5);

  const hasV6=
    hasV5 &&
    columnExists(db,'llm_pricing_rules','time_band') &&
    columnExists(db,'llm_pricing_rules','context_band') &&
    columnExists(db,'llm_pricing_rules','cache_write_microusd_per_million') &&
    tableExists(db,'llm_fx_rates') &&
    columnExists(db,'llm_usage_events','cache_write_tokens') &&
    columnExists(db,'llm_usage_events','service_tier') &&
    columnExists(db,'llm_usage_events','estimated_cost_microntd') &&
    columnExists(db,'llm_usage_events','fx_rate_microunits_per_usd') &&
    columnExists(db,'llm_usage_events','fx_rate_id');
  if(hasV6) inferred=Math.max(inferred,6);

  const hasV7=hasV6 && Boolean(
    db.prepare("select 1 from llm_pricing_rules where id='builtin-ollama-direct-deepseek-v4-pro-peak-20260927'").get()
  );
  if(hasV7) inferred=Math.max(inferred,7);

  const hasV8=hasV7 && tableExists(db,'llm_provider_session_state');
  if(hasV8) inferred=Math.max(inferred,8);

  const hasV9=
    hasV8 &&
    columnExists(db,'interview_sessions','teacher_snapshot') &&
    tableExists(db,'interview_coach_events');
  if(hasV9) inferred=Math.max(inferred,9);

  const hasV10=hasV9 && tableExists(db,'evaluation_failure_diagnostics');
  if(hasV10) inferred=Math.max(inferred,10);

  const hasV11=hasV10 && tableExists(db,'evaluation_audits');
  if(hasV11) inferred=Math.max(inferred,11);

  if(inferred>recorded) db.pragma('user_version = '+inferred);
  return inferred;
}

export function applySqliteMigrations(db,{projectRoot}){
  let current=Number(db.pragma('user_version',{simple:true})||0);
  current=reconcileSqliteMigrationVersion(db,current);
  const seen=new Set();
  for(const migration of migrationFiles(projectRoot)){
    if(seen.has(migration.version)) throw new Error('DUPLICATE_SQLITE_MIGRATION_VERSION_'+migration.version);
    seen.add(migration.version);
    if(migration.version<=current) continue;
    const sql=readFileSync(join(projectRoot,'db','migrations',migration.name),'utf8');
    db.transaction(()=>{
      db.exec(sql);
      db.pragma('user_version = '+migration.version);
    })();
    current=migration.version;
  }
  return current;
}
