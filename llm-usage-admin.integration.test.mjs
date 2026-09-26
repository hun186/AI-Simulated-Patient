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

    const adminPricing=response();
    await handler(request('POST',{action:'createPricingRule',preset:'openai',modelPattern:'gpt-test',inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000,effectiveAt:'2026-01-01T00:00:00Z'},adminAuth),adminPricing);

    await query("insert into llm_usage_events (user_id,agent_type,provider_kind,preset,model,input_tokens,output_tokens,total_tokens,latency_ms,success,usage_status,estimated_cost_microusd,pricing_status,created_at) values ($1,'patient','openai','openai','gpt-test',10,5,15,2,true,'reported',20,'priced',$2)",[assigned.id,'2026-09-26T04:00:00.000Z']);
    await query("insert into llm_usage_events (user_id,agent_type,provider_kind,preset,model,input_tokens,output_tokens,total_tokens,latency_ms,success,usage_status,estimated_cost_microusd,pricing_status,created_at) values ($1,'coach','openai','openai','gpt-test',4,2,6,2,true,'reported',5,'partial',$2)",[assigned.id,'2026-09-26T05:00:00.000Z']);
    const teacherSummary=response();
    await handler(request('GET',null,teacherAuth,{action:'summary',userId:assigned.id,from:'2026-09-26T00:00:00.000Z',to:'2026-09-27T00:00:00.000Z'}),teacherSummary);

    console.log(JSON.stringify({
      teacherUsers:{status:teacherUsers.statusCode,ids:(teacherUsers.body.users||[]).map(x=>x.id).sort()},
      teacherSetAssigned:{status:teacherSetAssigned.statusCode,quota:teacherSetAssigned.body.quota},
      teacherSetOther:{status:teacherSetOther.statusCode,body:teacherSetOther.body},
      teacherSetSelf:{status:teacherSetSelf.statusCode,body:teacherSetSelf.body},
      teacherPricing:{status:teacherPricing.statusCode,body:teacherPricing.body},
      adminSetOther:{status:adminSetOther.statusCode,quota:adminSetOther.body.quota},
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
    assert.equal(data.adminPricing.status,201);
    assert.equal(data.adminPricing.rule.modelPattern,'gpt-test');
    assert.equal(data.adminPricing.rule.timeBand,'always');
    assert.equal(data.teacherSummary.status,200);
    assert.equal(Number(data.teacherSummary.body.totals[0].tokens),21);
    assert.equal(Number(data.teacherSummary.body.totals[0].estimatedCostMicrousd),25);
    assert.equal(Number(data.teacherSummary.body.totals[0].partialPricingCalls),1);
    assert.equal(data.teacherSummary.body.byDate[0].date,'2026-09-26');
    assert.equal(Number(data.teacherSummary.body.byDate[0].tokens),21);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
