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
    const user=db.prepare("select id,email from app_users where id='legacy-admin'").get()||null;
    return {tables,columns,routeColumns,user};
  }finally{
    db.close();
  }
}

test('fresh SQLite database advances to schema version 5 with LLM provider foundation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-fresh-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const info=openThroughApplication(dbPath);
    const state=inspect(dbPath);
    assert.equal(info.schemaVersion,5);
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
    assert.equal(state.routeColumns.has('owner_user_id'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('existing schema version 1 database migrates to version 5 without losing data',()=>{
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
    assert.equal(info.schemaVersion,5);
    assert.deepEqual(state.user,{id:'legacy-admin',email:'legacy@example.com'});
    for(const table of ['llm_provider_connections','llm_agent_routes','llm_usage_events']){
      assert.equal(state.tables.has(table),true,table+' missing');
    }
    assert.equal(state.columns.has('llm_route_snapshot'),true);
    assert.equal(state.routeColumns.has('owner_user_id'),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('migrated SQLite database can reopen without replaying migration 002',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-reopen-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const first=openThroughApplication(dbPath);
    assert.equal(first.schemaVersion,5);
    const second=openThroughApplication(dbPath);
    assert.equal(second.schemaVersion,5);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('database whose user_version was reset to 1 is reconciled from applied migration artifacts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-migrate-reconcile-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const first=openThroughApplication(dbPath);
    assert.equal(first.schemaVersion,5);

    const damaged=new Database(dbPath);
    damaged.pragma('user_version = 1');
    assert.equal(damaged.pragma('user_version',{simple:true}),1);
    damaged.close();

    const recovered=openThroughApplication(dbPath);
    assert.equal(recovered.schemaVersion,5);
    const check=new Database(dbPath,{readonly:true});
    try{
      assert.equal(check.pragma('user_version',{simple:true}),5);
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
