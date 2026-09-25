import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('student self-registration stays pending until assigned teacher approval',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-register-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='development';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const registerHandler=(await import('./api/auth/register.js')).default;
    const usersHandler=(await import('./api/teacher/users.js')).default;

    function request(body={},headers={}){
      return {
        method:'POST',
        body,
        headers:{origin:'http://localhost',host:'localhost','user-agent':'integration-test',...headers},
        socket:{remoteAddress:'127.0.0.1'}
      };
    }
    function response(){
      return {
        statusCode:200,headers:{},body:null,
        status(code){this.statusCode=code;return this;},
        setHeader(name,value){this.headers[name]=value;},
        json(data){this.body=data;return data;},
        end(data=''){this.body=data;return data;}
      };
    }

    const adminPassword='AdminPass!2026';
    const teacherPassword='TeacherPass!2026';
    const studentPassword='StudentPass!2026';

    const preInitRes=response();
    await registerHandler(request({
      displayName:'Too Early',
      email:'early@example.com',
      password:studentPassword
    }),preInitRes);

    await createUser({
      email:'admin@example.com',password:adminPassword,displayName:'Admin One',role:'admin',status:'active'
    });
    const teacher=await createUser({
      email:'teacher@example.com',password:teacherPassword,displayName:'Teacher One',role:'teacher',status:'active'
    });

    const registrationBody={
      displayName:'Student One',
      email:'student@example.com',
      password:studentPassword,
      requestedTeacherEmail:'teacher@example.com'
    };
    const regReq=request(registrationBody);
    const regRes=response();
    await registerHandler(regReq,regRes);

    const student=(await query("select * from app_users where email=$1",['student@example.com']))[0];
    const assignment=(await query(
      'select * from teacher_student_assignments where teacher_user_id=$1 and student_user_id=$2',
      [teacher.id,student.id]
    ))[0];

    const pendingLogin=await loginUser({
      email:'student@example.com',password:studentPassword,req:request()
    });

    const teacherAuth=await loginUser({
      email:'teacher@example.com',password:teacherPassword,req:request()
    });
    const approveReq=request(
      {action:'approve',userId:student.id},
      {
        cookie:'aisp_session='+encodeURIComponent(teacherAuth.token),
        'x-csrf-token':teacherAuth.csrfToken
      }
    );
    const approveRes=response();
    await usersHandler(approveReq,approveRes);

    const activated=(await query("select * from app_users where id=$1",[student.id]))[0];
    const activeLogin=await loginUser({
      email:'student@example.com',password:studentPassword,req:request()
    });

    const duplicateRes=response();
    await registerHandler(request(registrationBody),duplicateRes);
    const duplicateCount=(await query(
      "select count(*) as count from app_users where lower(email)=lower($1)",
      ['student@example.com']
    ))[0].count;

    console.log(JSON.stringify({
      preInit:{status:preInitRes.statusCode,body:preInitRes.body},
      registration:{status:regRes.statusCode,body:regRes.body},
      student:{
        status:student.account_status,
        isActive:Boolean(student.is_active),
        passwordStoredAsPlaintext:student.password_hash===studentPassword
      },
      assignment:Boolean(assignment),
      pendingLogin:Boolean(pendingLogin),
      approval:{status:approveRes.statusCode,body:approveRes.body},
      activated:{status:activated.account_status,isActive:Boolean(activated.is_active)},
      activeLogin:Boolean(activeLogin),
      duplicate:{status:duplicateRes.statusCode,body:duplicateRes.body,count:Number(duplicateCount)}
    }));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath},
    encoding:'utf8'
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.preInit.status,503);
    assert.match(data.preInit.body.error,/管理員初始化/);
    assert.equal(data.registration.status,202);
    assert.equal(data.registration.body.accepted,true);
    assert.match(data.registration.body.message,/等待.*核准/);
    assert.equal(data.student.status,'pending');
    assert.equal(data.student.isActive,false);
    assert.equal(data.student.passwordStoredAsPlaintext,false);
    assert.equal(data.assignment,true);
    assert.equal(data.pendingLogin,false);
    assert.equal(data.approval.status,200);
    assert.deepEqual(data.approval.body,{ok:true,accountStatus:'active'});
    assert.equal(data.activated.status,'active');
    assert.equal(data.activated.isActive,true);
    assert.equal(data.activeLogin,true);
    assert.equal(data.duplicate.status,202);
    assert.equal(data.duplicate.body.message,data.registration.body.message);
    assert.equal(data.duplicate.count,1);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
