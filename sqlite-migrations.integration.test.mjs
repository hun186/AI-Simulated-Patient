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
    const user=db.prepare("select id,email from app_users where id='legacy-admin'").get()||null;
    return {tables,columns,user};
  }finally{
    db.close();
  }
}

test('fresh SQLite database advances to schema version 3 with LLM provider foundation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-fresh-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const info=openThroughApplication(dbPath);
    const state=inspect(dbPath);
    assert.equal(info.schemaVersion,3);
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('existing schema version 1 database migrates to version 3 without losing data',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-v1-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const legacy=new Database(dbPath);
    legacy.exec(readFileSync(resolve('db/sqlite-schema.sql'),'utf8'));
    legacy.prepare(
      "insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values (?,?,?,?,?,?,?,?)"
    ).run('legacy-admin','legacy@example.com','Legacy Admin','admin','salt','hash',1,'active');
    assert.equal(legacy.pragma('user_version',{simple:true}),1);
    legacy.close();

    const info=openThroughApplication(dbPath);
    const state=inspect(dbPath);
    assert.equal(info.schemaVersion,3);
    assert.deepEqual(state.user,{id:'legacy-admin',email:'legacy@example.com'});
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
