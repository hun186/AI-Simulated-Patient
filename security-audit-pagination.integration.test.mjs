import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('security audit API paginates, filters, and preserves self-only scope',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-security-audit-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='test';
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const handler=(await import('./api/auth/audit.js')).default;

    function response(){return {statusCode:200,body:null,headers:{},status(c){this.statusCode=c;return this;},setHeader(n,v){this.headers[n]=v;},json(v){this.body=v;return v;},end(v=''){this.body=v;return v;}};}
    function req(auth,queryParams={}){return {
      method:'GET',query:queryParams,
      headers:{origin:'http://localhost',host:'localhost','user-agent':'audit-test',cookie:'aisp_session='+encodeURIComponent(auth.token)},
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const admin=await createUser({email:'audit-admin@example.com',password:'AdminPass!2026',displayName:'Audit Admin',role:'admin'});
    const teacher=await createUser({email:'audit-teacher@example.com',password:'TeacherPass!2026',displayName:'Audit Teacher',role:'teacher'});
    const student=await createUser({email:'audit-student@example.com',password:'StudentPass!2026',displayName:'Audit Student',role:'student'});
    const other=await createUser({email:'audit-other@example.com',password:'StudentPass!2026',displayName:'Other Student',role:'student'});

    const insert='insert into auth_audit_events (action,success,reason,actor_user_id,target_user_id,identifier,client_host,user_agent,metadata_json,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
    for(let i=0;i<23;i++){
      await query(insert,[
        i%2===0?'auth.login':'user.approve',
        i%3!==0,
        i%3===0?'bad password':'ok',
        i%4===0?teacher.id:admin.id,
        i%5===0?student.id:null,
        i%3===0?'student@example.com':'admin@example.com',
        i%3===0?'10.0.0.7':'10.0.0.1',
        'test-agent',
        JSON.stringify({i}),
        new Date(Date.UTC(2026,8,1,0,i)).toISOString()
      ]);
    }
    await query(insert,['unrelated.event',true,'outside teacher scope',other.id,student.id,'other@example.com','10.0.0.9','test-agent','{}','2026-09-01T02:00:00.000Z']);

    const adminAuth=await loginUser({email:'audit-admin@example.com',password:'AdminPass!2026',req:{headers:{origin:'http://localhost',host:'localhost','user-agent':'x'},socket:{remoteAddress:'127.0.0.1'}}});
    const teacherAuth=await loginUser({email:'audit-teacher@example.com',password:'TeacherPass!2026',req:{headers:{origin:'http://localhost',host:'localhost','user-agent':'x'},socket:{remoteAddress:'127.0.0.1'}}});

    const page2=response();
    await handler(req(adminAuth,{page:'2',pageSize:'10',from:'2026-09-01T00:00:00Z',to:'2026-09-02T00:00:00Z'}),page2);

    const filtered=response();
    await handler(req(adminAuth,{
      page:'1',pageSize:'25',from:'2026-09-01T00:00:00Z',to:'2026-09-02T00:00:00Z',
      action:'auth.login',success:'failure',q:'10.0.0.7'
    }),filtered);

    const teacherView=response();
    await handler(req(teacherAuth,{page:'1',pageSize:'100',from:'2026-09-01T00:00:00Z',to:'2026-09-02T00:00:00Z'}),teacherView);

    const invalid=response();
    await handler(req(adminAuth,{from:'not-a-date'}),invalid);

    console.log(JSON.stringify({
      page2:{status:page2.statusCode,body:page2.body},
      filtered:{status:filtered.statusCode,body:filtered.body},
      teacherView:{status:teacherView.statusCode,body:teacherView.body},
      invalid:{status:invalid.statusCode,body:invalid.body},
      teacherId:teacher.id
    }));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'test'},encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.page2.status,200);
    assert.equal(data.page2.body.pagination.page,2);
    assert.equal(data.page2.body.pagination.pageSize,10);
    assert.equal(data.page2.body.pagination.total,24);
    assert.equal(data.page2.body.pagination.totalPages,3);
    assert.equal(data.page2.body.events.length,10);
    assert.equal(data.page2.body.isRestrictedToSelf,false);
    assert.equal(data.page2.body.filters.actions.includes('auth.login'),true);
    assert.equal(data.page2.body.filters.actions.includes('unrelated.event'),true);

    assert.equal(data.filtered.status,200);
    assert.equal(data.filtered.body.events.length>0,true);
    assert.equal(data.filtered.body.events.every(e=>e.action==='auth.login'&&e.success===false&&e.clientHost==='10.0.0.7'),true);
    assert.equal(data.filtered.body.events.every(e=>e.actor&&e.actor.id),true);

    assert.equal(data.teacherView.status,200);
    assert.equal(data.teacherView.body.isRestrictedToSelf,true);
    assert.equal(data.teacherView.body.events.every(e=>e.actorUserId===data.teacherId||e.targetUserId===data.teacherId),true);
    assert.equal(data.teacherView.body.events.some(e=>e.action==='unrelated.event'),false);

    assert.equal(data.invalid.status,400);
    assert.equal(data.invalid.body.error,'INVALID_AUDIT_FROM');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
