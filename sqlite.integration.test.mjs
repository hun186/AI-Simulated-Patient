import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('SQLite backend auto-creates schema and supports PostgreSQL-style query facade',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-sqlite-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    const {query,databaseInfo}=await import('./lib/db.js');
    await query("insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values ($1,$2,$3,$4,$5,$6,$7,$8)",['u1','one@example.com','One','admin','salt','hash',true,'active']);
    const inserted=await query("insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status) values ($1,1,$2,$3,$4,$5,$6::jsonb,'published') returning id",['c1','Internal','Case A','入門','Brief',JSON.stringify({opening:'hi',patient:{name:'P'}})]);
    const counts=await query("select count(*)::int as count from app_users where role=$1",['admin']);
    await query("update app_users set updated_at=now() where id=$1",['u1']);
    const info=await databaseInfo();
    console.log(JSON.stringify({inserted,counts,info}));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath},
    encoding:'utf8'
  });
  try{
    assert.equal(result.status,0,result.stderr);
    assert.equal(existsSync(dbPath),true);
    const payload=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(payload.inserted[0].id,'c1');
    assert.equal(payload.counts[0].count,1);
    assert.equal(payload.info.driver,'sqlite');
    assert.equal(payload.info.wal,true);
    assert.equal(payload.info.schemaVersion,5);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
