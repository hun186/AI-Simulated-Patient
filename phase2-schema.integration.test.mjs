import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function openThroughApplication(dbPath){
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    const {databaseInfo,query}=await import('./lib/db.js');
    const info=await databaseInfo();
    await query("insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values ($1,$2,$3,$4,$5,$6,$7,$8)",['u1','u1@example.com','U1','student','s','h',true,'active']);
    await query("insert into llm_user_quotas (user_id,daily_token_limit,monthly_cost_limit_microusd) values ($1,$2,$3)",['u1',0,2500000]);
    const quota=(await query('select * from llm_user_quotas where user_id=$1',['u1']))[0];
    console.log(JSON.stringify({info,quota}));
  `;
  return spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath},encoding:'utf8'
  });
}

test('fresh SQLite database advances to schema version 6 with pricing and quota tables',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-phase2-schema-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const result=openThroughApplication(dbPath);
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.info.schemaVersion,6);
    assert.equal(data.quota.daily_token_limit,0);
    assert.equal(data.quota.monthly_token_limit,null);
    assert.equal(data.quota.monthly_cost_limit_microusd,2500000);

    const db=new Database(dbPath,{readonly:true});
    const tables=new Set(db.prepare("select name from sqlite_master where type='table'").all().map(x=>x.name));
    const usageCols=new Set(db.prepare('pragma table_info(llm_usage_events)').all().map(x=>x.name));
    const pricingCols=new Set(db.prepare('pragma table_info(llm_pricing_rules)').all().map(x=>x.name));
    assert.equal(tables.has('llm_pricing_rules'),true);
    assert.equal(tables.has('llm_user_quotas'),true);
    assert.equal(tables.has('llm_fx_rates'),true);
    for(const name of ['estimated_cost_microusd','pricing_status','pricing_rule_id','cache_write_tokens','service_tier','estimated_cost_microntd','fx_rate_microunits_per_usd','fx_rate_id'])assert.equal(usageCols.has(name),true,name);
    for(const name of ['time_band','context_band','cache_write_microusd_per_million'])assert.equal(pricingCols.has(name),true,name);
    assert.equal(db.prepare("select count(*) as count from llm_pricing_rules where preset='deepseek' and time_band in ('peak','off_peak')").get().count,6);
    db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('PostgreSQL schema preserves Phase 2 usage cost/status constraints',()=>{
  const schema=readFileSync('db/schema.sql','utf8');
  assert.match(schema,/llm_usage_events_estimated_cost_nonnegative/);
  assert.match(schema,/check \(estimated_cost_microusd is null or estimated_cost_microusd >= 0\)/);
  assert.match(schema,/llm_usage_events_pricing_status_check/);
  assert.match(schema,/check \(pricing_status in \('priced','unpriced','partial'\)\)/);
  assert.match(schema,/time_band text not null default 'always'/);
  assert.match(schema,/deepseek-flash','peak',300000,6000,1200000/);
  assert.match(schema,/deepseek-v4-pro','off_peak',660000,22000,1980000/);
  assert.match(schema,/context_band text not null default 'any'/);
  assert.match(schema,/cache_write_microusd_per_million/);
  assert.match(schema,/llm_fx_rates/);
  assert.match(schema,/31780000,'CBC interbank closing rate 2026-09-24'/);
  assert.match(schema,/gpt-6-sol\*','always','short',2000000,200000,2500000,10000000/);
});
