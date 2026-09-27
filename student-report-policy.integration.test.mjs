import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('student report export is enforced by case policy and case ownership',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-student-report-policy-'));
  const dbPath=join(dir,'aisp.sqlite');

  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='development';
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const {createInterviewSession,appendMessage,completeSession}=await import('./lib/server-sessions.js');
    const {ensureBuiltinCase}=await import('./lib/server-cases.js');
    const teacherCases=(await import('./api/teacher/cases.js')).default;
    const studentReport=(await import('./api/student/report.js')).default;

    function response(){return {
      statusCode:200,body:null,headers:{},
      status(c){this.statusCode=c;return this;},
      setHeader(n,v){this.headers[n]=v;},
      json(v){this.body=v;return v;},
      end(v=''){this.body=v;return v;}
    };}

    function baseReq(){
      return {
        headers:{origin:'http://localhost',host:'localhost','user-agent':'student-report-policy-test'},
        socket:{remoteAddress:'127.0.0.1'}
      };
    }

    function authHeaders(auth){
      return {
        ...baseReq().headers,
        cookie:'aisp_session='+encodeURIComponent(auth.token),
        'x-csrf-token':auth.csrfToken
      };
    }

    function postReq(auth,body){
      return {
        ...baseReq(),
        method:'POST',
        body,
        headers:authHeaders(auth)
      };
    }

    function getReq(auth,sessionId){
      return {
        ...baseReq(),
        method:'GET',
        query:{sessionId},
        headers:authHeaders(auth)
      };
    }

    async function complete(mode,student,caseId){
      const session=await createInterviewSession({user:student,caseId,mode,coachEnabled:false});
      await appendMessage(session.id,'student','測試問題');
      await appendMessage(session.id,'patient','測試回答');
      await completeSession(session.id,{
        totalScore:1,maxScore:1,percentage:100,
        items:[{
          id:'R1',criterion:'測試項目',status:'covered',score:1,maxScore:1,
          evidence:[{turn:1,quote:'測試問題'}],reasoning:'完成'
        }],
        overall:{
          comment:'完成',strengths:['完成'],improvements:[],
          recommendations:['繼續'],nextPracticeFocus:'維持'
        }
      });
      return session;
    }

    await ensureBuiltinCase();

    const admin=await createUser({
      email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'
    });
    const teacher1=await createUser({
      email:'teacher1@example.com',password:'TeacherPass!2026',displayName:'林老師',role:'teacher'
    });
    const teacher2=await createUser({
      email:'teacher2@example.com',password:'TeacherPass!2026',displayName:'陳老師',role:'teacher'
    });
    const student=await createUser({
      email:'student@example.com',password:'StudentPass!2026',displayName:'王同學',role:'student'
    });
    await query(
      'insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$1)',
      [teacher1.id,student.id]
    );

    const adminAuth=await loginUser({email:'admin@example.com',password:'AdminPass!2026',req:baseReq()});
    const t1Auth=await loginUser({email:'teacher1@example.com',password:'TeacherPass!2026',req:baseReq()});
    const t2Auth=await loginUser({email:'teacher2@example.com',password:'TeacherPass!2026',req:baseReq()});
    const studentAuth=await loginUser({email:'student@example.com',password:'StudentPass!2026',req:baseReq()});

    const createRes=response();
    await teacherCases(postReq(t1Auth,{
      definition:{
        id:'teacher_case_report',
        title:'教師病例',
        studentLabel:'案例｜學生報告政策',
        difficulty:'入門',
        studentBrief:'練習用',
        studentReportExportPolicy:'training_only',
        learningGoals:['完成問診'],
        patient:{name:'測試病人',age:40,gender:'女',persona:'自然回答'},
        opening:'你好。',
        facts:[],
        rubric:[]
      },
      status:'published'
    }),createRes);

    const caseId=createRes.body.id;
    const training=await complete('training',student,caseId);
    const exam=await complete('exam',student,caseId);

    const trainingRes=response();
    await studentReport(getReq(studentAuth,training.id),trainingRes);

    const examBlocked=response();
    await studentReport(getReq(studentAuth,exam.id),examBlocked);

    const teacher2Denied=response();
    await teacherCases(postReq(t2Auth,{
      action:'setStudentReportExportPolicy',
      caseId,
      studentReportExportPolicy:'all_completed'
    }),teacher2Denied);

    const ownerAllowAll=response();
    await teacherCases(postReq(t1Auth,{
      action:'setStudentReportExportPolicy',
      caseId,
      studentReportExportPolicy:'all_completed'
    }),ownerAllowAll);

    const examAllowed=response();
    await studentReport(getReq(studentAuth,exam.id),examAllowed);

    const ownerDisable=response();
    await teacherCases(postReq(t1Auth,{
      action:'setStudentReportExportPolicy',
      caseId,
      studentReportExportPolicy:'disabled'
    }),ownerDisable);

    const trainingDisabled=response();
    await studentReport(getReq(studentAuth,training.id),trainingDisabled);

    const teacherBuiltinDenied=response();
    await teacherCases(postReq(t1Auth,{
      action:'setStudentReportExportPolicy',
      caseId:'aphasia_001',
      studentReportExportPolicy:'all_completed'
    }),teacherBuiltinDenied);

    const adminBuiltinAllowed=response();
    await teacherCases(postReq(adminAuth,{
      action:'setStudentReportExportPolicy',
      caseId:'aphasia_001',
      studentReportExportPolicy:'all_completed'
    }),adminBuiltinAllowed);

    const otherStudent=await createUser({
      email:'other@example.com',password:'OtherPass!2026',displayName:'其他學生',role:'student'
    });
    const otherAuth=await loginUser({email:'other@example.com',password:'OtherPass!2026',req:baseReq()});
    const foreignRes=response();
    await studentReport(getReq(otherAuth,training.id),foreignRes);

    console.log(JSON.stringify({
      createStatus:createRes.statusCode,
      training:{status:trainingRes.statusCode,body:trainingRes.body},
      examBlocked:{status:examBlocked.statusCode,body:examBlocked.body},
      teacher2Denied:{status:teacher2Denied.statusCode,body:teacher2Denied.body},
      ownerAllowAll:{status:ownerAllowAll.statusCode,body:ownerAllowAll.body},
      examAllowed:{status:examAllowed.statusCode,body:examAllowed.body},
      ownerDisable:{status:ownerDisable.statusCode,body:ownerDisable.body},
      trainingDisabled:{status:trainingDisabled.statusCode,body:trainingDisabled.body},
      teacherBuiltinDenied:{status:teacherBuiltinDenied.statusCode,body:teacherBuiltinDenied.body},
      adminBuiltinAllowed:{status:adminBuiltinAllowed.statusCode,body:adminBuiltinAllowed.body},
      foreign:{status:foreignRes.statusCode,body:foreignRes.body}
    }));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'development'},
    encoding:'utf8',timeout:30000
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.createStatus,201);

    assert.equal(data.training.status,200);
    assert.equal(data.training.body.record.studentReportExportPolicy,'training_only');
    assert.equal(data.training.body.record.studentName,'王同學');
    assert.equal(data.training.body.record.mode,'training');

    assert.equal(data.examBlocked.status,403);
    assert.equal(data.examBlocked.body.error,'STUDENT_REPORT_EXPORT_NOT_ALLOWED');

    assert.equal(data.teacher2Denied.status,403);
    assert.equal(data.ownerAllowAll.status,200);

    assert.equal(data.examAllowed.status,200);
    assert.equal(data.examAllowed.body.record.mode,'exam');
    assert.equal(data.examAllowed.body.record.studentReportExportPolicy,'all_completed');

    assert.equal(data.ownerDisable.status,200);
    assert.equal(data.trainingDisabled.status,403);

    assert.equal(data.teacherBuiltinDenied.status,403);
    assert.equal(data.adminBuiltinAllowed.status,200);

    assert.equal(data.foreign.status,404);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
