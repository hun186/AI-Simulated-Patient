import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('student report export policy enforces owner, completion, mode and current case policy',()=>{
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
    const reportHandler=(await import('./api/student/report.js')).default;
    const teacherCasesHandler=(await import('./api/teacher/cases.js')).default;

    function response(){return {
      statusCode:200,body:null,headers:{},
      status(code){this.statusCode=code;return this;},
      setHeader(name,value){this.headers[name]=value;},
      json(value){this.body=value;return value;},
      end(value=''){this.body=value;return value;}
    };}
    function authRequest(auth,{method='GET',query={},body={}}={}){
      return {
        method,query,body,
        headers:{
          origin:'http://localhost',host:'localhost','user-agent':'student-report-policy-test',
          cookie:'aisp_session='+encodeURIComponent(auth.token),
          ...(method!=='GET'?{'x-csrf-token':auth.csrfToken}:{})
        },
        socket:{remoteAddress:'127.0.0.1'}
      };
    }

    const teacher=await createUser({
      email:'teacher@example.com',password:'TeacherPass!2026',
      displayName:'林老師',role:'teacher'
    });
    const otherTeacher=await createUser({
      email:'other@example.com',password:'OtherTeacher!2026',
      displayName:'陳老師',role:'teacher'
    });
    const student=await createUser({
      email:'student@example.com',password:'StudentPass!2026',
      displayName:'王同學',role:'student'
    });
    await query(
      'insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$1)',
      [teacher.id,student.id]
    );

    const definition={
      id:'report_policy_case',
      title:'報告下載政策測試',
      studentLabel:'案例｜報告下載政策',
      difficulty:'入門',
      studentBrief:'測試病例',
      studentReportExportPolicy:'training_only',
      patient:{name:'測試病人',age:50,gender:'女',persona:'簡短回答'},
      opening:'你好。',
      facts:[{id:'fact1',label:'主訴',category:'test',value:'測試答案',triggers:['主訴'],mayVolunteer:false}],
      rubric:[{id:'r1',label:'主訴',factIds:['fact1'],points:1}]
    };
    await query(
      'insert into cases '+
      '(id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by) '+
      "values ($1,1,$2,$3,$4,$5,$6::jsonb,'published',$7)",
      [definition.id,definition.title,definition.studentLabel,definition.difficulty,definition.studentBrief,JSON.stringify(definition),teacher.id]
    );

    const studentAuth=await loginUser({
      email:'student@example.com',password:'StudentPass!2026',
      req:authRequest({token:'',csrfToken:''})
    });
    const teacherAuth=await loginUser({
      email:'teacher@example.com',password:'TeacherPass!2026',
      req:authRequest({token:'',csrfToken:''})
    });
    const otherAuth=await loginUser({
      email:'other@example.com',password:'OtherTeacher!2026',
      req:authRequest({token:'',csrfToken:''})
    });

    const training=await createInterviewSession({
      user:student,caseId:definition.id,mode:'training',coachEnabled:false
    });
    await appendMessage(training.id,'student','主訴是什麼？');
    await appendMessage(training.id,'patient','測試答案');
    await completeSession(training.id,{
      totalScore:1,maxScore:1,percentage:100,
      items:[{id:'r1',criterion:'主訴',status:'covered',score:1,maxScore:1,evidence:[{turn:2,quote:'主訴是什麼？'}],reasoning:'已涵蓋'}],
      overall:{comment:'完成',strengths:['完整'],improvements:[],recommendations:['持續練習'],nextPracticeFocus:'結構化問診'}
    });

    const trainAllowed=response();
    await reportHandler(authRequest(studentAuth,{query:{sessionId:training.id}}),trainAllowed);

    const exam=await createInterviewSession({
      user:student,caseId:definition.id,mode:'exam',coachEnabled:false
    });
    await completeSession(exam.id,{
      totalScore:1,maxScore:1,percentage:100,
      items:[{id:'r1',criterion:'主訴',status:'covered',score:1,maxScore:1,evidence:[],reasoning:'已涵蓋'}],
      overall:{comment:'完成',strengths:[],improvements:[],recommendations:[],nextPracticeFocus:'—'}
    });

    const examDenied=response();
    await reportHandler(authRequest(studentAuth,{query:{sessionId:exam.id}}),examDenied);

    const updateAll=response();
    await teacherCasesHandler(authRequest(teacherAuth,{
      method:'POST',
      body:{action:'setStudentReportExportPolicy',caseId:definition.id,studentReportExportPolicy:'all_completed'}
    }),updateAll);

    const examAllowed=response();
    await reportHandler(authRequest(studentAuth,{query:{sessionId:exam.id}}),examAllowed);

    const otherTeacherDenied=response();
    await teacherCasesHandler(authRequest(otherAuth,{
      method:'POST',
      body:{action:'setStudentReportExportPolicy',caseId:definition.id,studentReportExportPolicy:'disabled'}
    }),otherTeacherDenied);

    const updateDisabled=response();
    await teacherCasesHandler(authRequest(teacherAuth,{
      method:'POST',
      body:{action:'setStudentReportExportPolicy',caseId:definition.id,studentReportExportPolicy:'disabled'}
    }),updateDisabled);

    const trainRevoked=response();
    await reportHandler(authRequest(studentAuth,{query:{sessionId:training.id}}),trainRevoked);

    console.log(JSON.stringify({
      trainAllowed:{status:trainAllowed.statusCode,body:trainAllowed.body},
      examDenied:{status:examDenied.statusCode,body:examDenied.body},
      updateAll:{status:updateAll.statusCode,body:updateAll.body},
      examAllowed:{status:examAllowed.statusCode,body:examAllowed.body},
      otherTeacherDenied:{status:otherTeacherDenied.statusCode,body:otherTeacherDenied.body},
      updateDisabled:{status:updateDisabled.statusCode,body:updateDisabled.body},
      trainRevoked:{status:trainRevoked.statusCode,body:trainRevoked.body}
    }));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'development'},
    encoding:'utf8',
    timeout:30000
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.trainAllowed.status,200);
    assert.equal(data.trainAllowed.body.record.studentName,'王同學');
    assert.equal(data.trainAllowed.body.record.studentReportExportPolicy,'training_only');
    assert.equal(data.trainAllowed.body.record.transcript.some(item=>item.content==='主訴是什麼？'),true);
    assert.equal('estimatedCostMicrousd' in (data.trainAllowed.body.record.llmUsage[0]||{}),false);

    assert.equal(data.examDenied.status,403);
    assert.equal(data.examDenied.body.error,'STUDENT_REPORT_EXPORT_NOT_ALLOWED');

    assert.equal(data.updateAll.status,200);
    assert.equal(data.updateAll.body.studentReportExportPolicy,'all_completed');
    assert.equal(data.examAllowed.status,200);

    assert.equal(data.otherTeacherDenied.status,403);

    assert.equal(data.updateDisabled.status,200);
    assert.equal(data.trainRevoked.status,403);
    assert.equal(data.trainRevoked.body.studentReportExportPolicy,'disabled');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
