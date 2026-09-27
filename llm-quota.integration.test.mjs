import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('quota service enforces daily/monthly token and cost dimensions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-quota-service-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      process.env.DB_DRIVER='sqlite';
      process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
      const {query}=await import('./lib/db.js');
      const {enforceLlmQuota}=await import('./lib/llm/quota.js');
      await query("insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values ($1,$2,$3,$4,$5,$6,$7,$8)",['u1','u1@example.com','U1','student','s','h',true,'active']);
      await query("insert into llm_user_quotas (user_id,daily_token_limit,monthly_token_limit,daily_cost_limit_microusd,monthly_cost_limit_microusd) values ($1,$2,$3,$4,$5)",['u1',100,1000,500,5000]);
      await query("insert into llm_usage_events (user_id,agent_type,provider_kind,preset,model,input_tokens,total_tokens,latency_ms,success,usage_status,estimated_cost_microusd,pricing_status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        ['u1','patient','openai','openai','gpt-test',100,100,1,true,'reported',500,'priced']);
      await query("update llm_usage_events set created_at=$2 where user_id=$1",['u1','2026-09-26T01:00:00.000Z']);
      const now=new Date('2026-09-26T12:00:00.000Z');
      const dimensions=[];
      try{await enforceLlmQuota({userId:'u1',now});}catch(e){dimensions.push(e.dimension);}
      await query("update llm_user_quotas set daily_token_limit=101,monthly_token_limit=100,daily_cost_limit_microusd=500,monthly_cost_limit_microusd=5000 where user_id=$1",['u1']);
      try{await enforceLlmQuota({userId:'u1',now});}catch(e){dimensions.push(e.dimension);}
      await query("update llm_user_quotas set monthly_token_limit=101,daily_cost_limit_microusd=500,monthly_cost_limit_microusd=5000 where user_id=$1",['u1']);
      try{await enforceLlmQuota({userId:'u1',now});}catch(e){dimensions.push(e.dimension);}
      await query("update llm_user_quotas set daily_cost_limit_microusd=501,monthly_cost_limit_microusd=500 where user_id=$1",['u1']);
      try{await enforceLlmQuota({userId:'u1',now});}catch(e){dimensions.push(e.dimension);}
      console.log(JSON.stringify(dimensions));
    `;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
      cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath},encoding:'utf8'
    });
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),[
      'daily_tokens','monthly_tokens','daily_cost','monthly_cost'
    ]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('production chat quota rejection returns 429 before provider call and does not mutate session or usage',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-quota-runtime-'));
  const dbPath=join(dir,'aisp.sqlite');
  const key=Buffer.alloc(32,9).toString('base64');
  try{
    const script=`
      process.env.DB_DRIVER='sqlite';
      process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
      process.env.APP_ENV='production';
      process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key)};
      process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

      const http=await import('node:http');
      let providerCalls=0;
      const server=http.createServer(async(req,res)=>{
        providerCalls++;
        for await(const _ of req){}
        res.writeHead(200,{'content-type':'application/json'});
        res.end(JSON.stringify({id:'p1',model:'test-model',choices:[{message:{content:'should not happen'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';

      const {query}=await import('./lib/db.js');
      const {createUser,loginUser}=await import('./lib/server-auth.js');
      const {createConnection}=await import('./lib/llm/connections.js');
      const {setSystemRoute}=await import('./lib/llm/routes.js');
      const sessionsHandler=(await import('./api/sessions.js')).default;
      const chatHandler=(await import('./api/chat.js')).default;

      function response(){return {statusCode:200,body:null,headers:{},status(c){this.statusCode=c;return this;},setHeader(n,v){this.headers[n]=v;},json(v){this.body=v;return v;},end(v=''){this.body=v;return v;}};}
      function request(body,auth){return {method:'POST',body,headers:{origin:'http://localhost',host:'localhost','user-agent':'quota-test',...(auth?{cookie:'aisp_session='+encodeURIComponent(auth.token),'x-csrf-token':auth.csrfToken}:{})},socket:{remoteAddress:'127.0.0.1'}};}

      const admin=await createUser({email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
      const student=await createUser({email:'student@example.com',password:'StudentPass!2026',displayName:'Student',role:'student'});
      const auth=await loginUser({email:'student@example.com',password:'StudentPass!2026',req:request({},null)});
      const connection=await createConnection(admin,{name:'Local',preset:'custom',baseUrl,defaultModel:'test-model',apiKey:''});
      await setSystemRoute(admin,{agentType:'patient',connectionId:connection.id,model:'test-model'});
      await setSystemRoute(admin,{agentType:'evaluator',connectionId:connection.id,model:'test-model'});
      const createRes=response();
      await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createRes);
      const sessionId=createRes.body.session.id;
      await query("insert into llm_user_quotas (user_id,daily_token_limit) values ($1,$2)",[student.id,0]);

      const beforeMessages=(await query('select count(*) as count from interview_messages where session_id=$1',[sessionId]))[0].count;
      const beforeUsage=(await query('select count(*) as count from llm_usage_events where user_id=$1',[student.id]))[0].count;
      const res=response();
      await chatHandler(request({sessionId,message:'hello'},auth),res);
      const afterMessages=(await query('select count(*) as count from interview_messages where session_id=$1',[sessionId]))[0].count;
      const afterUsage=(await query('select count(*) as count from llm_usage_events where user_id=$1',[student.id]))[0].count;
      const session=(await query('select status from interview_sessions where id=$1',[sessionId]))[0];

      console.log(JSON.stringify({
        status:res.statusCode,body:res.body,providerCalls,
        beforeMessages:Number(beforeMessages),afterMessages:Number(afterMessages),
        beforeUsage:Number(beforeUsage),afterUsage:Number(afterUsage),sessionStatus:session.status
      }));
      await new Promise(resolve=>server.close(resolve));
    `;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
      cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'production',LLM_SECRET_MASTER_KEY:key},
      encoding:'utf8',timeout:30000
    });
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.status,429);
    assert.equal(data.body.error,'AI_USAGE_QUOTA_EXCEEDED');
    assert.equal(data.body.dimension,'daily_tokens');
    assert.equal(data.providerCalls,0);
    assert.equal(data.afterMessages,data.beforeMessages);
    assert.equal(data.afterUsage,data.beforeUsage);
    assert.equal(data.sessionStatus,'active');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
