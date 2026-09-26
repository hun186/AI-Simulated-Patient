import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function openThroughApplication(dbPath){
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    const {databaseInfo}=await import('./lib/db.js');
    console.log(JSON.stringify(await databaseInfo()));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath},
    encoding:'utf8'
  });
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function inspect(dbPath){
  const db=new Database(dbPath,{readonly:true});
  try{
    const tables=new Set(db.prepare("select name from sqlite_master where type='table'").all().map(row=>row.name));
    const columns=new Set(db.prepare("pragma table_info(interview_sessions)").all().map(row=>row.name));
    const routeColumns=new Set(db.prepare("pragma table_info(llm_agent_routes)").all().map(row=>row.name));
    const pricingColumns=new Set(db.prepare("pragma table_info(llm_pricing_rules)").all().map(row=>row.name));
    const user=db.prepare("select id,email from app_users where id='legacy-admin'").get()||null;
    return {tables,columns,routeColumns,pricingColumns,user};
  }finally{
    db.close();
  }
}

test('fresh SQLite database advances to schema version 6 with LLM provider foundation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-fresh-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const info=openThroughApplication(dbPath);
    const state=inspect(dbPath);
    assert.equal(info.schemaVersion,6);
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
    assert.equal(state.routeColumns.has('owner_user_id'),true);
    assert.equal(state.pricingColumns.has('time_band'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('existing schema version 1 database migrates to version 6 without losing data',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-v1-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const legacy=new Database(dbPath);
    legacy.exec(readFileSync(resolve('db/sqlite-schema.sql'),'utf8'));
    legacy.pragma('user_version = 1');
    legacy.prepare(
      "insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values (?,?,?,?,?,?,?,?)"
    ).run('legacy-admin','legacy@example.com','Legacy Admin','admin','salt','hash',1,'active');
    assert.equal(legacy.pragma('user_version',{simple:true}),1);
    legacy.close();

    const info=openThroughApplication(dbPath);
    const state=inspect(dbPath);
    assert.equal(info.schemaVersion,6);
    assert.deepEqual(state.user,{id:'legacy-admin',email:'legacy@example.com'});
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
    assert.equal(state.routeColumns.has('owner_user_id'),true);
    assert.equal(state.pricingColumns.has('time_band'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('migrated SQLite database can reopen without replaying migration 002',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-reopen-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const first=openThroughApplication(dbPath);
    assert.equal(first.schemaVersion,6);
    const second=openThroughApplication(dbPath);
    assert.equal(second.schemaVersion,6);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('database whose user_version was reset to 1 is reconciled from applied migration artifacts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-reconcile-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const first=openThroughApplication(dbPath);
    assert.equal(first.schemaVersion,6);

    const damaged=new Database(dbPath);
    damaged.pragma('user_version = 1');
    assert.equal(damaged.pragma('user_version',{simple:true}),1);
    damaged.close();

    const recovered=openThroughApplication(dbPath);
    assert.equal(recovered.schemaVersion,6);
    const check=new Database(dbPath,{readonly:true});
    try{
      assert.equal(check.pragma('user_version',{simple:true}),6);
      assert.equal(
        check.prepare("select count(*) as count from sqlite_master where type='table' and name='llm_provider_connections'").get().count,
        1
      );
    }finally{
      check.close();
    }
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('schema version 4 teacher routes are backfilled with route owner during v5 migration',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-v4-route-owner-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const legacy=new Database(dbPath);
    legacy.exec(readFileSync(resolve('db/sqlite-schema.sql'),'utf8'));
    for(const name of [
      '002_llm_provider_foundation.sql',
      '003_llm_usage_status.sql',
      '004_llm_usage_cost_quota.sql'
    ]){
      legacy.exec(readFileSync(resolve('db/migrations',name),'utf8'));
    }
    legacy.pragma('user_version = 4');
    legacy.prepare(
      "insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values (?,?,?,?,?,?,?,?)"
    ).run('teacher-v4','teacher-v4@example.com','Teacher v4','teacher','salt','hash',1,'active');
    legacy.prepare(
      "insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by) values (?,?,?,?,?,?,?,?,?)"
    ).run('teacher-case-v4',1,'Legacy Case','Legacy Case','test','',JSON.stringify({id:'teacher-case-v4',title:'Legacy Case',patient:{name:'P'},opening:'hi',facts:[],rubric:[]}),'published','teacher-v4');
    legacy.prepare(
      "insert into llm_provider_connections (id,scope_type,owner_user_id,name,provider_kind,preset,base_url,default_model,is_active,created_by) values (?,?,?,?,?,?,?,?,?,?)"
    ).run('conn-v4','teacher','teacher-v4','Teacher DeepSeek','openai_compatible','deepseek','https://api.deepseek.com','deepseek-flash',1,'teacher-v4');
    legacy.prepare(
      "insert into llm_agent_routes (id,scope_type,scope_id,agent_type,connection_id,model,config_json,created_by) values (?,?,?,?,?,?,?,?)"
    ).run('route-v4','case','teacher-case-v4','patient','conn-v4','deepseek-flash','{}','teacher-v4');
    legacy.close();

    const info=openThroughApplication(dbPath);
    assert.equal(info.schemaVersion,6);

    const upgraded=new Database(dbPath,{readonly:true});
    try{
      const route=upgraded.prepare("select owner_user_id from llm_agent_routes where id='route-v4'").get();
      assert.equal(route.owner_user_id,'teacher-v4');
    }finally{
      upgraded.close();
    }
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});


test('schema version 5 pricing rules migrate to v6 time bands without losing custom rules',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-v5-pricing-band-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const legacy=new Database(dbPath);
    legacy.exec(readFileSync(resolve('db/sqlite-schema.sql'),'utf8'));
    for(const name of [
      '002_llm_provider_foundation.sql',
      '003_llm_usage_status.sql',
      '004_llm_usage_cost_quota.sql',
      '005_teacher_case_route_owner.sql'
    ]){
      legacy.exec(readFileSync(resolve('db/migrations',name),'utf8'));
    }
    legacy.pragma('user_version = 5');
    legacy.prepare(
      "insert into llm_pricing_rules (id,preset,model_pattern,input_microusd_per_million,cached_input_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at,is_active) values (?,?,?,?,?,?,?,?,?)"
    ).run('custom-v5','openai','gpt-custom',100,50,200,200,'2026-01-01T00:00:00Z',1);
    legacy.close();

    const info=openThroughApplication(dbPath);
    assert.equal(info.schemaVersion,6);

    const upgraded=new Database(dbPath,{readonly:true});
    try{
      const custom=upgraded.prepare("select time_band from llm_pricing_rules where id='custom-v5'").get();
      assert.equal(custom.time_band,'always');
      const seeded=upgraded.prepare("select count(*) as count from llm_pricing_rules where id like 'builtin-deepseek-%'").get();
      assert.equal(seeded.count,6);
    }finally{
      upgraded.close();
    }
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
