import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('production LLM runtime uses snapshotted routes, records usage, and never falls back to mock',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-llm-runtime-'));
  const dbPath=join(dir,'aisp.sqlite');
  const key=Buffer.alloc(32,7).toString('base64');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='production';
    process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key)};
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const http=await import('node:http');
    let providerMode='ok';
    const evaluation={
      totalScore:10,maxScore:10,percentage:100,
      items:[{id:'history',criterion:'history',status:'covered',score:10,maxScore:10,evidence:[{turn:2,quote:'history?'}],reasoning:'covered'}],
      overall:{comment:'good',strengths:['history'],improvements:[],recommendations:['continue'],nextPracticeFocus:'depth'}
    };
    const server=http.createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw||'{}');
      if(providerMode==='http-fail'){res.writeHead(500,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'secret upstream body'}}));}
      const system=String(body.messages?.[0]?.content||'');
      let content='patient answer';
      if(system.includes('learning coach')) content='Ask one focused follow-up question.';
      if(body.response_format?.type==='json_object') content=providerMode==='invalid-eval'?'not-json':JSON.stringify(evaluation);
      const payload={id:'provider-1',model:'test-model',choices:[{message:{content}}]};
      if(providerMode!=='no-usage') payload.usage={prompt_tokens:11,completion_tokens:4,total_tokens:15};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const {createConnection}=await import('./lib/llm/connections.js');
    const {setSystemRoute,deleteRoute}=await import('./lib/llm/routes.js');
    const sessionsHandler=(await import('./api/sessions.js')).default;
    const chatHandler=(await import('./api/chat.js')).default;
    const coachHandler=(await import('./api/coach.js')).default;
    const evaluateHandler=(await import('./api/evaluate.js')).default;

    function response(){return {statusCode:200,body:null,headers:{},status(c){this.statusCode=c;return this;},setHeader(n,v){this.headers[n]=v;},json(v){this.body=v;return v;},end(v=''){this.body=v;return v;}};}
    function request(body,auth){return {
      method:'POST',body,
      headers:{origin:'http://localhost',host:'localhost','user-agent':'runtime-test',
        ...(auth?{cookie:'aisp_session='+encodeURIComponent(auth.token),'x-csrf-token':auth.csrfToken}:{})},
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const admin=await createUser({email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
    const student=await createUser({email:'student@example.com',password:'StudentPass!2026',displayName:'Student',role:'student'});
    const auth=await loginUser({email:'student@example.com',password:'StudentPass!2026',req:request({},null)});

    const missingRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),missingRes);
    const missingCount=(await query('select count(*) as count from interview_sessions'))[0].count;

    const connection=await createConnection(admin,{name:'Local test',preset:'custom',baseUrl,defaultModel:'test-model',apiKey:''});
    await setSystemRoute(admin,{agentType:'patient',connectionId:connection.id,model:'test-model'});
    const coachRoute=await setSystemRoute(admin,{agentType:'coach',connectionId:connection.id,model:'test-model'});

    const missingEvaluatorRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),missingEvaluatorRes);

    await setSystemRoute(admin,{agentType:'evaluator',connectionId:connection.id,model:'test-model'});

    const createRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:true},auth),createRes);
    const sessionId=createRes.body.session.id;

    const chatRes=response();
    await chatHandler(request({sessionId,message:'history?'},auth),chatRes);
    const afterSuccess=await query('select role,content from interview_messages where session_id=$1 order by id',[sessionId]);

    providerMode='http-fail';
    const beforeFail=afterSuccess.length;
    const failRes=response();
    await chatHandler(request({sessionId,message:'this must fail'},auth),failRes);
    const afterFail=await query('select role,content from interview_messages where session_id=$1 order by id',[sessionId]);

    providerMode='no-usage';
    const coachRes=response();
    await coachHandler(request({sessionId},auth),coachRes);

    providerMode='invalid-eval';
    const invalidEvalRes=response();
    await evaluateHandler(request({sessionId},auth),invalidEvalRes);
    const activeAfterInvalid=(await query('select status from interview_sessions where id=$1',[sessionId]))[0].status;

    providerMode='ok';
    const evalRes=response();
    await evaluateHandler(request({sessionId},auth),evalRes);
    const completed=(await query('select status from interview_sessions where id=$1',[sessionId]))[0].status;
    const evalRows=await query('select * from evaluations where session_id=$1',[sessionId]);
    const usageRows=await query('select agent_type,success,error_code,total_tokens,usage_status from llm_usage_events where session_id=$1 order by id',[sessionId]);

    await deleteRoute(admin,coachRoute.id);
    const createNoCoachRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createNoCoachRes);
    const sessionNoCoach=createNoCoachRes.body.session.id;
    const enableMissingCoachRes=response();
    await sessionsHandler(request({action:'setCoach',sessionId:sessionNoCoach,coachEnabled:true},auth),enableMissingCoachRes);
    const coachStateAfterRejectedEnable=(await query('select coach_enabled from interview_sessions where id=$1',[sessionNoCoach]))[0].coach_enabled;

    console.log(JSON.stringify({
      missing:{status:missingRes.statusCode,body:missingRes.body,count:Number(missingCount)},
      missingEvaluator:{status:missingEvaluatorRes.statusCode,body:missingEvaluatorRes.body},
      created:{status:createRes.statusCode},
      chat:{status:chatRes.statusCode,body:chatRes.body,messages:afterSuccess},
      failure:{status:failRes.statusCode,body:failRes.body,beforeFail,afterFail:afterFail.length},
      coach:{status:coachRes.statusCode,body:coachRes.body},
      invalidEval:{status:invalidEvalRes.statusCode,body:invalidEvalRes.body,sessionStatus:activeAfterInvalid},
      evaluation:{status:evalRes.statusCode,body:evalRes.body,sessionStatus:completed,rows:evalRows.length},
      enableMissingCoach:{status:enableMissingCoachRes.statusCode,body:enableMissingCoachRes.body,coachEnabled:Boolean(coachStateAfterRejectedEnable)},
      usage:usageRows
    }));
    await new Promise(resolve=>server.close(resolve));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'production',LLM_SECRET_MASTER_KEY:key},
    encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.missing.status,503);
    assert.equal(data.missing.body.error,'AI_PROVIDER_NOT_CONFIGURED');
    assert.equal(data.missing.count,0);
    assert.equal(data.missingEvaluator.status,503);
    assert.equal(data.missingEvaluator.body.error,'AI_EVALUATOR_PROVIDER_NOT_CONFIGURED');
    assert.equal(data.created.status,201);
    assert.equal(data.chat.status,200);
    assert.equal(data.chat.body.reply,'patient answer');
    assert.deepEqual(data.chat.messages.slice(-2),[
      {role:'student',content:'history?'},{role:'patient',content:'patient answer'}
    ]);
    assert.equal(data.failure.status,502);
    assert.equal(data.failure.afterFail,data.failure.beforeFail);
    assert.equal(data.coach.status,200);
    assert.equal(data.coach.body.nextHint,'Ask one focused follow-up question.');
    assert.equal(data.invalidEval.status,502);
    assert.equal(data.invalidEval.sessionStatus,'active');
    assert.equal(data.evaluation.status,200);
    assert.equal(data.evaluation.sessionStatus,'completed');
    assert.equal(data.evaluation.rows,1);
    assert.equal(data.enableMissingCoach.status,503);
    assert.equal(data.enableMissingCoach.body.error,'AI_COACH_PROVIDER_NOT_CONFIGURED');
    assert.equal(data.enableMissingCoach.coachEnabled,false);
    assert.deepEqual(data.usage.map(x=>x.agent_type),['patient','patient','coach','evaluator','evaluator']);
    assert.equal(Boolean(data.usage[0].success),true);
    assert.equal(data.usage[0].total_tokens,15);
    assert.equal(data.usage[0].usage_status,'reported');
    assert.equal(Boolean(data.usage[1].success),false);
    assert.equal(data.usage[1].usage_status,'unreported');
    assert.equal(data.usage[2].usage_status,'unreported');
    assert.equal(Boolean(data.usage[3].success),false);
    assert.equal(data.usage[3].error_code,'INVALID_EVALUATION_CONTRACT');
    assert.equal(Boolean(data.usage[4].success),true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
