import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Teacher records API returns export-ready people transcript Coach LLM and evaluation context',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-report-records-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='development';
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const {
      createInterviewSession,appendMessage,appendCoachEvent,completeSession
    }=await import('./lib/server-sessions.js');
    const recordsHandler=(await import('./api/teacher/records.js')).default;

    function response(){return {
      statusCode:200,body:null,headers:{},
      status(c){this.statusCode=c;return this;},
      setHeader(n,v){this.headers[n]=v;},
      json(v){this.body=v;return v;},
      end(v=''){this.body=v;return v;}
    };}
    function request(auth){return {
      method:'GET',
      headers:{
        origin:'http://localhost',host:'localhost','user-agent':'report-test',
        cookie:'aisp_session='+encodeURIComponent(auth.token)
      },
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const teacher=await createUser({
      email:'teacher@example.com',password:'TeacherPass!2026',
      displayName:'林老師',role:'teacher'
    });
    const student=await createUser({
      email:'student@example.com',password:'StudentPass!2026',
      displayName:'王同學',role:'student'
    });
    await query(
      'insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$1)',
      [teacher.id,student.id]
    );

    const session=await createInterviewSession({
      user:student,caseId:'aphasia_001',mode:'training',coachEnabled:true
    });
    await appendMessage(session.id,'student','你的聲音沙啞多久了？');
    await appendMessage(session.id,'patient','大概半年多了。');
    await appendCoachEvent(session.id,{
      provider:'openai',model:'gpt-test',
      progress:{covered:1,partial:0,total:3},
      lastQuestion:{text:'你的聲音沙啞多久了？',level:'good',comment:'問題聚焦。'},
      nextHint:'接著詢問症狀變化。',
      reflectionPrompt:'想想還需要問哪些情境。'
    });

    await query(
      'insert into llm_usage_events '+
      '(user_id,session_id,case_id,agent_type,provider_kind,preset,model,'+
      ' input_tokens,output_tokens,total_tokens,latency_ms,success) '+
      "values ($1,$2,$3,'patient','openai','openai','gpt-test',10,5,15,120,1)",
      [student.id,session.id,'aphasia_001']
    );

    await completeSession(session.id,{
      totalScore:1,maxScore:1,percentage:100,
      items:[{
        id:'H01',criterion:'主訴',status:'covered',score:1,maxScore:1,
        evidence:[{turn:2,quote:'你的聲音沙啞多久了？'}],
        reasoning:'有詢問病程。'
      }],
      overall:{
        comment:'完成主要問診。',
        strengths:['問題清楚'],improvements:[],
        recommendations:['繼續練習'],nextPracticeFocus:'症狀變化'
      }
    });

    const teacherAuth=await loginUser({
      email:'teacher@example.com',password:'TeacherPass!2026',
      req:{headers:{origin:'http://localhost',host:'localhost','user-agent':'report-test'},socket:{remoteAddress:'127.0.0.1'}}
    });
    const firstRes=response();
    await recordsHandler(request(teacherAuth),firstRes);

    await query(
      "update interview_sessions set teacher_snapshot='[]'::jsonb where id=$1",
      [session.id]
    );
    const fallbackRes=response();
    await recordsHandler(request(teacherAuth),fallbackRes);

    console.log(JSON.stringify({
      firstStatus:firstRes.statusCode,
      first:firstRes.body.records[0],
      fallbackStatus:fallbackRes.statusCode,
      fallback:fallbackRes.body.records[0]
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
    assert.equal(data.firstStatus,200);
    assert.equal(data.first.studentName,'王同學');
    assert.equal(data.first.teachers[0].displayName,'林老師');
    assert.equal(data.first.teacherSource,'session_snapshot');
    assert.equal(data.first.transcript.some(x=>x.content==='你的聲音沙啞多久了？'),true);
    assert.equal(data.first.coachEvents.length,1);
    assert.equal(data.first.coachEvents[0].nextHint,'接著詢問症狀變化。');
    assert.equal(data.first.llmRoutes.patient.preset,'mock');
    assert.equal(data.first.llmUsage.length,1);
    assert.equal(data.first.llmUsage[0].agentType,'patient');
    assert.equal(data.first.llmUsage[0].totalTokens,15);
    assert.equal(data.first.evaluation.overall.comment,'完成主要問診。');

    assert.equal(data.fallbackStatus,200);
    assert.equal(data.fallback.teacherSource,'current_assignment');
    assert.equal(data.fallback.teachers[0].displayName,'林老師');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
