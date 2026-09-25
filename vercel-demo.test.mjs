import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Vercel without DATABASE_URL selects browser persistence and mock auth',()=>{
  const script=`
    delete process.env.DATABASE_URL;
    delete process.env.DB_DRIVER;
    process.env.VERCEL='1';
    const {databaseDriver,isDatabaseEnabled}=await import('./lib/db.js');
    const runtime=(await import('./api/runtime.js')).default;
    const req={method:'GET',headers:{}};
    const res={
      statusCode:200,body:null,
      status(code){this.statusCode=code;return this;},
      json(data){this.body=data;return data;}
    };
    await runtime(req,res);
    console.log(JSON.stringify({
      driver:databaseDriver(),
      enabled:isDatabaseEnabled(),
      status:res.statusCode,
      body:res.body
    }));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,VERCEL:'1',DATABASE_URL:'',DB_DRIVER:''},
    encoding:'utf8'
  });
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(data.driver,'browser');
  assert.equal(data.enabled,false);
  assert.equal(data.status,200);
  assert.equal(data.body.persistence,'browser');
  assert.equal(data.body.auth,false);
  assert.equal(data.body.demoAuth,true);
});

test('explicit SQLite remains available outside Vercel bundle path',()=>{
  const script=`
    delete process.env.VERCEL;
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=':memory:';
    const {query,databaseInfo}=await import('./lib/db.js');
    await query('select 1 as ok');
    console.log(JSON.stringify(await databaseInfo()));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,VERCEL:'',DB_DRIVER:'sqlite',SQLITE_PATH:':memory:'},
    encoding:'utf8'
  });
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(data.driver,'sqlite');
  assert.equal(data.wal,true);
});
