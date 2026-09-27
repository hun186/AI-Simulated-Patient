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
      if(body.response_format?.type==='json_object'){
        const repairing=system.includes('JSON repair step');
        if(providerMode==='invalid-eval') content=repairing?JSON.stringify(evaluation):'{"totalScore":10}';
        else if(providerMode==='persistent-invalid-eval') content='{"totalScore":10}';
        else if(providerMode==='normalized-eval') content=JSON.stringify({
          ...evaluation,
          totalScore:7,maxScore:100,percentage:7,
          items:[{...evaluation.items[0],evidence:['[2] student: history?']}]
        });
        else content=JSON.stringify(evaluation);
      }
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
    const repairedEvalRes=response();
    await evaluateHandler(request({sessionId},auth),repairedEvalRes);
    const completedAfterRepair=(await query('select status from interview_sessions where id=$1',[sessionId]))[0].status;
    const evalRows=await query('select * from evaluations where session_id=$1',[sessionId]);
    const repairedAuditRows=await query(
      'select evaluation_id as "evaluationId",status,audit_json as audit from evaluation_audits where session_id=$1 order by created_at desc',
      [sessionId]
    );
    const repairedAudit=repairedAuditRows[0]
      ?{...repairedAuditRows[0],audit:typeof repairedAuditRows[0].audit==='string'?JSON.parse(repairedAuditRows[0].audit):repairedAuditRows[0].audit}
      :null;
    const usageRows=await query('select agent_type,success,error_code,total_tokens,usage_status from llm_usage_events where session_id=$1 order by id',[sessionId]);

    const createNormalizedRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createNormalizedRes);
    const normalizedSessionId=createNormalizedRes.body.session.id;
    providerMode='normalized-eval';
    const normalizedEvalRes=response();
    await evaluateHandler(request({sessionId:normalizedSessionId},auth),normalizedEvalRes);
    const normalizedAuditRows=await query(
      'select evaluation_id as "evaluationId",status,audit_json as audit from evaluation_audits where session_id=$1 order by created_at desc',
      [normalizedSessionId]
    );
    const normalizedAudit=normalizedAuditRows[0]
      ?{...normalizedAuditRows[0],audit:typeof normalizedAuditRows[0].audit==='string'?JSON.parse(normalizedAuditRows[0].audit):normalizedAuditRows[0].audit}
      :null;

    const createPersistentRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createPersistentRes);
    const persistentSessionId=createPersistentRes.body.session.id;
    providerMode='persistent-invalid-eval';
    const persistentInvalidRes=response();
    await evaluateHandler(request({sessionId:persistentSessionId},auth),persistentInvalidRes);
    const activeAfterPersistentInvalid=(await query('select status from interview_sessions where id=$1',[persistentSessionId]))[0].status;
    const diagnosticRows=await query(
      'select error_id as "errorId",diagnostic_json as diagnostic from evaluation_failure_diagnostics where session_id=$1 order by created_at desc',
      [persistentSessionId]
    );
    const persistedDiagnostic=diagnosticRows[0]
      ?(typeof diagnosticRows[0].diagnostic==='string'?JSON.parse(diagnosticRows[0].diagnostic):diagnosticRows[0].diagnostic)
      :null;
    const failedAuditRows=await query(
      'select evaluation_id as "evaluationId",status,audit_json as audit from evaluation_audits where session_id=$1 order by created_at desc',
      [persistentSessionId]
    );
    const failedAudit=failedAuditRows[0]
      ?{...failedAuditRows[0],audit:typeof failedAuditRows[0].audit==='string'?JSON.parse(failedAuditRows[0].audit):failedAuditRows[0].audit}
      :null;

    const createProviderFailRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createProviderFailRes);
    const providerFailSessionId=createProviderFailRes.body.session.id;
    providerMode='http-fail';
    const providerFailEvalRes=response();
    await evaluateHandler(request({sessionId:providerFailSessionId},auth),providerFailEvalRes);
    const providerFailAuditRows=await query(
      'select evaluation_id as "evaluationId",status,audit_json as audit from evaluation_audits where session_id=$1 order by created_at desc',
      [providerFailSessionId]
    );
    const providerFailAudit=providerFailAuditRows[0]
      ?{...providerFailAuditRows[0],audit:typeof providerFailAuditRows[0].audit==='string'?JSON.parse(providerFailAuditRows[0].audit):providerFailAuditRows[0].audit}
      :null;

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
      repairedEvaluation:{status:repairedEvalRes.statusCode,body:repairedEvalRes.body,sessionStatus:completedAfterRepair,rows:evalRows.length,audit:repairedAudit},
      normalizedEvaluation:{status:normalizedEvalRes.statusCode,body:normalizedEvalRes.body,audit:normalizedAudit},
      persistentInvalid:{status:persistentInvalidRes.statusCode,body:persistentInvalidRes.body,sessionStatus:activeAfterPersistentInvalid,audit:failedAudit},
      providerFailureEvaluation:{status:providerFailEvalRes.statusCode,body:providerFailEvalRes.body,audit:providerFailAudit},
      persistedDiagnostic,
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
    assert.equal(data.repairedEvaluation.status,200);
    assert.equal(data.repairedEvaluation.sessionStatus,'completed');
    assert.equal(data.repairedEvaluation.rows,1);
    assert.equal(data.repairedEvaluation.body.totalScore,10);
    assert.equal(data.repairedEvaluation.body.audit.status,'success_repaired');
    assert.equal(data.repairedEvaluation.body.audit.persisted,true);
    assert.equal(data.repairedEvaluation.audit.status,'success_repaired');
    assert.equal(data.repairedEvaluation.audit.audit.repairUsed,true);
    assert.equal(data.repairedEvaluation.audit.audit.canonicalEvaluation.totalScore,10);

    assert.equal(data.normalizedEvaluation.status,200);
    assert.equal(data.normalizedEvaluation.body.totalScore,10);
    assert.equal(data.normalizedEvaluation.body.maxScore,10);
    assert.equal(data.normalizedEvaluation.body.percentage,100);
    assert.equal(data.normalizedEvaluation.body.audit.status,'success_normalized');
    assert.equal(data.normalizedEvaluation.audit.status,'success_normalized');
    assert.equal(data.normalizedEvaluation.audit.audit.normalization.applied,true);
    assert.equal(data.normalizedEvaluation.audit.audit.normalization.initial.actions.some(x=>x.type==='evidence_string_to_object'),true);
    assert.equal(data.normalizedEvaluation.audit.audit.normalization.initial.actions.some(x=>x.type==='aggregate_score_recomputed'),true);
    assert.match(data.normalizedEvaluation.audit.audit.attempts.initial.responseText,/\[2\] student: history\?/);

    assert.equal(data.persistentInvalid.status,502);
    assert.equal(data.persistentInvalid.body.code,'EVALUATION_REPAIR_FAILED');
    assert.equal(data.persistentInvalid.sessionStatus,'active');
    assert.equal(data.persistentInvalid.body.diagnostic.category,'evaluation_contract_repair_failed');
    assert.equal(data.persistentInvalid.audit.status,'failed');
    assert.equal(data.persistentInvalid.audit.audit.status,'failed');
    assert.equal(data.persistentInvalid.audit.evaluationId,data.persistentInvalid.body.diagnostic.errorId);
    assert.equal(data.persistentInvalid.body.diagnostic.audit.evaluationId,data.persistentInvalid.audit.evaluationId);
    assert.equal(data.persistentInvalid.body.diagnostic.session.id,data.persistedDiagnostic.session.id);
    assert.equal(data.persistentInvalid.body.diagnostic.session.userRole,'student');
    assert.equal(data.persistentInvalid.body.diagnostic.access.rawResponsesIncluded,false);
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.initial.responseText,'');
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.initial.responseRestricted,true);
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.repair.responseText,'');
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.repair.responseRestricted,true);
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.initial.validation.code,'INVALID_EVALUATION_CONTRACT');
    assert.equal(data.persistentInvalid.body.diagnostic.attempts.repair.validation.code,'EVALUATION_REPAIR_FAILED');
    assert.match(data.persistentInvalid.body.diagnostic.access.staffLookupPath,/\/api\/teacher\/evaluation-diagnostics\?errorId=EVL-/);
    assert.equal(JSON.stringify(data.persistentInvalid.body.diagnostic).includes('secret upstream body'),false);
    assert.equal(data.persistedDiagnostic.storage.persisted,true);
    assert.equal(data.persistedDiagnostic.session.id,data.persistentInvalid.body.diagnostic.session.id);
    assert.equal(data.persistedDiagnostic.attempts.initial.responseText,'{"totalScore":10}');
    assert.equal(data.persistedDiagnostic.attempts.repair.responseText,'{"totalScore":10}');

    assert.equal(data.providerFailureEvaluation.status,502);
    assert.equal(data.providerFailureEvaluation.body.error,'AI_PROVIDER_FAILURE');
    assert.equal(data.providerFailureEvaluation.body.audit.status,'failed');
    assert.equal(data.providerFailureEvaluation.body.audit.persisted,true);
    assert.equal(data.providerFailureEvaluation.audit.status,'failed');
    assert.equal(data.providerFailureEvaluation.audit.audit.attempts.initial.validation.code,'endpoint_unreachable');
    assert.equal(data.providerFailureEvaluation.audit.audit.attempts.initial.responseText,'');
    assert.equal(JSON.stringify(data.providerFailureEvaluation.audit.audit).includes('secret upstream body'),false);

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
    assert.equal(data.usage[4].error_code,null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
