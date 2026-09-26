import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
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

test('fresh SQLite database advances to schema version 4 with pricing and quota tables',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-phase2-schema-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const result=openThroughApplication(dbPath);
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.info.schemaVersion,4);
    assert.equal(data.quota.daily_token_limit,0);
    assert.equal(data.quota.monthly_token_limit,null);
    assert.equal(data.quota.monthly_cost_limit_microusd,2500000);

    const db=new Database(dbPath,{readonly:true});
    const tables=new Set(db.prepare("select name from sqlite_master where type='table'").all().map(x=>x.name));
    const usageCols=new Set(db.prepare('pragma table_info(llm_usage_events)').all().map(x=>x.name));
    assert.equal(tables.has('llm_pricing_rules'),true);
    assert.equal(tables.has('llm_user_quotas'),true);
    for(const name of ['estimated_cost_microusd','pricing_status','pricing_rule_id'])assert.equal(usageCols.has(name),true,name);
    db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
