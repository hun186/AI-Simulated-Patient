import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Vercel deployment is isolated to demo API instead of production auth/database functions',()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  const ignore=readFileSync('.vercelignore','utf8');
  const demo=readFileSync('api/demo.js','utf8');

  const rewrites=new Map((config.rewrites||[]).map(item=>[item.source,item.destination]));
  for(const route of ['/api/runtime','/api/health','/api/cases','/api/chat','/api/coach','/api/evaluate','/api/teacher/cases']){
    assert.match(rewrites.get(route)||'',/^\/api\/demo\?route=/,route+' must target demo API');
  }

  assert.match(ignore,/^\/api\/\*$/m);
  assert.match(ignore,/^!\/api\/demo\.js$/m);
  assert.match(ignore,/^!\/lib\/cases\.js$/m);
  assert.doesNotMatch(demo,/server-auth|server-sessions|db\.js|db-sqlite|db-postgres|better-sqlite3|neondatabase/);
});

test('Vercel demo API supports runtime, cases and patient chat without production persistence',async()=>{
  const handler=(await import('./api/demo.js')).default;

  function request({method='GET',route,body={}}){
    return {method,query:{route},body,headers:{host:'demo.vercel.app'}};
  }
  function response(){
    return {
      statusCode:200,body:null,headers:{},
      status(code){this.statusCode=code;return this;},
      setHeader(name,value){this.headers[name]=value;},
      json(value){this.body=value;return value;}
    };
  }

  const runtimeRes=response();
  await handler(request({route:'runtime'}),runtimeRes);
  assert.equal(runtimeRes.statusCode,200);
  assert.equal(runtimeRes.body.persistence,'browser');
  assert.equal(runtimeRes.body.demoAuth,true);

  const casesRes=response();
  await handler(request({route:'cases'}),casesRes);
  assert.equal(casesRes.statusCode,200);
  assert.equal(casesRes.body.cases[0].id,'aphasia_001');
  assert.equal('title' in casesRes.body.cases[0],false);

  const chatRes=response();
  await handler(request({
    method:'POST',
    route:'chat',
    body:{caseId:'aphasia_001',message:'請問以前有中風過嗎？',revealedFactIds:[]}
  }),chatRes);
  assert.equal(chatRes.statusCode,200);
  assert.match(chatRes.body.reply,/中風/);
});
