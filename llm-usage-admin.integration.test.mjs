import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('usage/quota API enforces Admin and Teacher scope',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-usage-admin-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='test';
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const handler=(await import('./api/teacher/llm-usage.js')).default;

    function response(){return {statusCode:200,body:null,headers:{},status(c){this.statusCode=c;return this;},setHeader(n,v){this.headers[n]=v;},json(v){this.body=v;return v;},end(v=''){this.body=v;return v;}};}
    function request(method,body,auth,queryParams={}){return {
      method,body,query:queryParams,
      headers:{origin:'http://localhost',host:'localhost','user-agent':'usage-admin-test',
        ...(auth?{cookie:'aisp_session='+encodeURIComponent(auth.token),'x-csrf-token':auth.csrfToken}:{})},
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const admin=await createUser({email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
    const teacher=await createUser({email:'teacher@example.com',password:'TeacherPass!2026',displayName:'Teacher',role:'teacher'});
    const assigned=await createUser({email:'assigned@example.com',password:'StudentPass!2026',displayName:'Assigned',role:'student'});
    const other=await createUser({email:'other@example.com',password:'StudentPass!2026',displayName:'Other',role:'student'});
    await query('insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$3)',[teacher.id,assigned.id,admin.id]);

    const adminAuth=await loginUser({email:'admin@example.com',password:'AdminPass!2026',req:request('POST',{},null)});
    const teacherAuth=await loginUser({email:'teacher@example.com',password:'TeacherPass!2026',req:request('POST',{},null)});

    const teacherUsers=response();
    await handler(request('GET',null,teacherAuth,{action:'users'}),teacherUsers);

    const teacherSetAssigned=response();
    await handler(request('POST',{action:'setQuota',userId:assigned.id,dailyTokenLimit:1000,monthlyCostLimitMicrousd:2000000},teacherAuth),teacherSetAssigned);

    const teacherSetOther=response();
    await handler(request('POST',{action:'setQuota',userId:other.id,dailyTokenLimit:1000},teacherAuth),teacherSetOther);

    const teacherSetSelf=response();
    await handler(request('POST',{action:'setQuota',userId:teacher.id,dailyTokenLimit:1000},teacherAuth),teacherSetSelf);

    const teacherPricing=response();
    await handler(request('POST',{action:'createPricingRule',preset:'openai',modelPattern:'gpt-*',inputMicrousdPerMillion:1000000},teacherAuth),teacherPricing);

    const adminSetOther=response();
    await handler(request('POST',{action:'setQuota',userId:other.id,dailyTokenLimit:0},adminAuth),adminSetOther);

    const teacherFx=response();
    await handler(request('POST',{action:'setFxRate',rate:31.9,source:'Teacher should not set'},teacherAuth),teacherFx);

    const adminFx=response();
    await handler(request('POST',{action:'setFxRate',rate:31.9,source:'Test reference',effectiveAt:'2026-09-26T00:00:00Z'},adminAuth),adminFx);

    const teacherFxRead=response();
    await handler(request('GET',null,teacherAuth,{action:'fx'}),teacherFxRead);

    const adminPricing=response();
    await handler(request('POST',{action:'createPricingRule',preset:'openai',modelPattern:'gpt-test',inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000,effectiveAt:'2026-01-01T00:00:00Z'},adminAuth),adminPricing);

    await query("insert into llm_usage_events (user_id,agent_type,provider_kind,preset,model,input_tokens,cached_input_tokens,cache_miss_tokens,cache_read_status,output_tokens,total_tokens,latency_ms,success,usage_status,estimated_cost_microusd,estimated_cost_microntd,cache_savings_microusd,cache_savings_microntd,pricing_status,created_at) values ($1,'patient','openai','openai','gpt-test',10,6,4,'reported',5,15,2,true,'reported',20,638,3,96,'priced',$2)",[assigned.id,'2026-09-26T04:00:00.000Z']);
    await query("insert into llm_usage_events (user_id,agent_type,provider_kind,preset,model,input_tokens,output_tokens,total_tokens,latency_ms,success,usage_status,estimated_cost_microusd,estimated_cost_microntd,pricing_status,created_at) values ($1,'coach','openai','openai','gpt-test',4,2,6,2,true,'reported',5,160,'partial',$2)",[assigned.id,'2026-09-26T05:00:00.000Z']);
    const teacherSummary=response();
    await handler(request('GET',null,teacherAuth,{action:'summary',userId:assigned.id,from:'2026-09-26T00:00:00.000Z',to:'2026-09-27T00:00:00.000Z'}),teacherSummary);

    console.log(JSON.stringify({
      teacherUsers:{status:teacherUsers.statusCode,ids:(teacherUsers.body.users||[]).map(x=>x.id).sort()},
      teacherSetAssigned:{status:teacherSetAssigned.statusCode,quota:teacherSetAssigned.body.quota},
      teacherSetOther:{status:teacherSetOther.statusCode,body:teacherSetOther.body},
      teacherSetSelf:{status:teacherSetSelf.statusCode,body:teacherSetSelf.body},
      teacherPricing:{status:teacherPricing.statusCode,body:teacherPricing.body},
      adminSetOther:{status:adminSetOther.statusCode,quota:adminSetOther.body.quota},
      teacherFx:{status:teacherFx.statusCode,body:teacherFx.body},
      adminFx:{status:adminFx.statusCode,fxRate:adminFx.body.fxRate},
      teacherFxRead:{status:teacherFxRead.statusCode,fxRate:teacherFxRead.body.fxRate},
      adminPricing:{status:adminPricing.statusCode,rule:adminPricing.body.rule},
      teacherSummary:{status:teacherSummary.statusCode,body:teacherSummary.body}
    }));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'test'},encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.teacherUsers.status,200);
    assert.equal(data.teacherUsers.ids.length,2);
    assert.equal(data.teacherSetAssigned.status,200);
    assert.equal(data.teacherSetAssigned.quota.dailyTokenLimit,1000);
    assert.equal(data.teacherSetOther.status,403);
    assert.equal(data.teacherSetSelf.status,403);
    assert.equal(data.teacherPricing.status,403);
    assert.equal(data.adminSetOther.status,200);
    assert.equal(data.adminSetOther.quota.dailyTokenLimit,0);
    assert.equal(data.teacherFx.status,403);
    assert.equal(data.adminFx.status,201);
    assert.equal(data.adminFx.fxRate.rate,31.9);
    assert.equal(data.teacherFxRead.status,200);
    assert.equal(data.teacherFxRead.fxRate.rate,31.9);
    assert.equal(data.adminPricing.status,201);
    assert.equal(data.adminPricing.rule.modelPattern,'gpt-test');
    assert.equal(data.adminPricing.rule.timeBand,'always');
    assert.equal(data.teacherSummary.status,200);
    assert.equal(Number(data.teacherSummary.body.totals[0].tokens),21);
    assert.equal(Number(data.teacherSummary.body.totals[0].estimatedCostMicrousd),25);
    assert.equal(Number(data.teacherSummary.body.totals[0].estimatedCostMicrontd),798);
    assert.equal(Number(data.teacherSummary.body.totals[0].partialPricingCalls),1);
    assert.equal(Number(data.teacherSummary.body.totals[0].cachedInputTokens),6);
    assert.equal(Number(data.teacherSummary.body.totals[0].cacheMissTokens),4);
    assert.equal(Number(data.teacherSummary.body.totals[0].cacheReportedCalls),1);
    assert.equal(Number(data.teacherSummary.body.totals[0].cacheSavingsMicrousd),3);
    assert.equal(Number(data.teacherSummary.body.byProvider[0].cachedInputTokens),6);
    assert.equal(data.teacherSummary.body.fxRate.rate,31.9);
    assert.equal(data.teacherSummary.body.byDate[0].date,'2026-09-26');
    assert.equal(Number(data.teacherSummary.body.byDate[0].tokens),21);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('usage analytics filters provider model agent case outcome cache and groups dates in browser timezone',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-usage-filters-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='test';
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const handler=(await import('./api/teacher/llm-usage.js')).default;

    function response(){return {statusCode:200,body:null,headers:{},status(c){this.statusCode=c;return this;},setHeader(n,v){this.headers[n]=v;},json(v){this.body=v;return v;},end(v=''){this.body=v;return v;}};}
    function request(auth,queryParams){return {
      method:'GET',body:null,query:queryParams,
      headers:{origin:'http://localhost',host:'localhost','user-agent':'usage-filter-test',
        cookie:'aisp_session='+encodeURIComponent(auth.token),'x-csrf-token':auth.csrfToken},
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const admin=await createUser({email:'admin-filter@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
    const teacher=await createUser({email:'teacher-filter@example.com',password:'TeacherPass!2026',displayName:'Teacher',role:'teacher'});
    const student=await createUser({email:'student-filter@example.com',password:'StudentPass!2026',displayName:'Assigned',role:'student'});
    const outsider=await createUser({email:'outsider-filter@example.com',password:'StudentPass!2026',displayName:'Other',role:'student'});
    await query('insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$3)',[teacher.id,student.id,admin.id]);
    await query("insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by) values ($1,1,$2,$3,'test','',$4,'published',$5)",
      ['case-filter','Internal Filter Case','篩選測試病例',JSON.stringify({id:'case-filter',title:'Filter',patient:{name:'P'},opening:'hi',facts:[],rubric:[]}),teacher.id]);

    const insert='insert into llm_usage_events '+
      '(user_id,case_id,agent_type,provider_kind,preset,model,input_tokens,cached_input_tokens,cache_miss_tokens,cache_read_status,'+
      ' output_tokens,total_tokens,latency_ms,success,usage_status,pricing_status,created_at) '+
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,'reported','unpriced',$14)";

    await query(insert,[student.id,'case-filter','evaluator','openai_compatible','deepseek','deepseek-flash',100,40,60,'reported',20,120,false,'2026-09-27T15:30:00.000Z']);
    await query(insert,[student.id,'case-filter','patient','openai_compatible','deepseek','deepseek-flash',80,10,70,'reported',10,90,true,'2026-09-27T16:30:00.000Z']);
    await query(insert,[student.id,'case-filter','evaluator','openai','openai','gpt-test',50,0,0,'unreported',5,55,true,'2026-09-27T10:00:00.000Z']);
    await query(insert,[outsider.id,'case-filter','evaluator','openai_compatible','deepseek','deepseek-flash',999,999,0,'reported',1,1000,false,'2026-09-27T15:30:00.000Z']);

    const auth=await loginUser({email:'teacher-filter@example.com',password:'TeacherPass!2026',req:{headers:{origin:'http://localhost',host:'localhost','user-agent':'x'},socket:{remoteAddress:'127.0.0.1'}}});
    const filtered=response();
    await handler(request(auth,{
      action:'summary',userId:student.id,
      from:'2026-09-27T00:00:00.000Z',to:'2026-09-29T00:00:00.000Z',
      provider:'deepseek',model:'deepseek-flash',agentType:'evaluator',caseId:'case-filter',
      outcome:'failure',cacheStatus:'reported',timeZoneOffsetMinutes:'-480'
    }),filtered);

    const forbidden=response();
    await handler(request(auth,{action:'summary',userId:outsider.id}),forbidden);

    console.log(JSON.stringify({filtered:{status:filtered.statusCode,body:filtered.body},forbidden:{status:forbidden.statusCode,body:forbidden.body}}));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'test'},encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.filtered.status,200);
    assert.equal(data.filtered.body.totals.length,1);
    const total=data.filtered.body.totals[0];
    assert.equal(Number(total.calls),1);
    assert.equal(Number(total.tokens),120);
    assert.equal(Number(total.inputTokens),100);
    assert.equal(Number(total.cacheReportedInputTokens),100);
    assert.equal(Number(total.cachedInputTokens),40);
    assert.equal(Number(total.cacheMissTokens),60);
    assert.equal(data.filtered.body.byDate.length,1);
    assert.equal(data.filtered.body.byDate[0].date,'2026-09-27');
    assert.deepEqual(data.filtered.body.byProvider.map(x=>x.preset),['deepseek']);
    assert.deepEqual(data.filtered.body.byModel.map(x=>x.model),['deepseek-flash']);
    assert.deepEqual(data.filtered.body.byAgent.map(x=>x.agentType),['evaluator']);
    assert.equal(data.filtered.body.byCase.length,1);
    assert.equal(data.filtered.body.byCase[0].caseLabel,'篩選測試病例');
    assert.deepEqual(data.filtered.body.filters.providers,['deepseek','openai']);
    assert.equal(data.filtered.body.filters.models.some(x=>x.provider==='openai'&&x.model==='gpt-test'),true);
    assert.equal(data.filtered.body.filters.cases[0].label,'篩選測試病例');
    assert.equal(data.filtered.body.range.timeZoneOffsetMinutes,-480);
    assert.equal(data.forbidden.status,403);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
