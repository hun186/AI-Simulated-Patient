import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('LLM route precedence and session snapshots are scoped and immutable',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-llm-routes-'));
  const dbPath=join(dir,'aisp.sqlite');
  const keyPath=join(dir,'llm-secret.key');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.LLM_SECRET_KEY_PATH=${JSON.stringify(keyPath)};
    process.env.APP_ENV='development';

    const {query}=await import('./lib/db.js');
    const {createUser}=await import('./lib/server-auth.js');
    const {createConnection}=await import('./lib/llm/connections.js');
    const {
      setSystemRoute,setCaseRoute,deleteRoute,resolveAgentRoutes,snapshotAgentRoutes
    }=await import('./lib/llm/routes.js');
    const {ensureBuiltinCase}=await import('./lib/server-cases.js');
    const {createInterviewSession,getOwnedSession}=await import('./lib/server-sessions.js');

    const admin=await createUser({email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
    const t1=await createUser({email:'t1@example.com',password:'TeacherPass!2026',displayName:'Teacher 1',role:'teacher'});
    const t2=await createUser({email:'t2@example.com',password:'TeacherPass!2026',displayName:'Teacher 2',role:'teacher'});
    const student=await createUser({email:'student@example.com',password:'StudentPass!2026',displayName:'Student',role:'student'});

    await ensureBuiltinCase();
    const definition=id=>JSON.stringify({
      id,title:id,studentLabel:id,difficulty:'test',studentBrief:'',learningGoals:[],
      patient:{name:'Patient',age:50,gender:'',persona:'test'},opening:'hello',facts:[],rubric:[]
    });
    await query(
      "insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by) values ($1,1,$1,$1,'test','',$2::jsonb,'published',$3)",
      ['t1_case',definition('t1_case'),t1.id]
    );
    await query(
      "insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by) values ($1,1,$1,$1,'test','',$2::jsonb,'published',$3)",
      ['t2_case',definition('t2_case'),t2.id]
    );

    const sysA=await createConnection(admin,{
      name:'System A',preset:'openai',defaultModel:'gpt-a',apiKey:'sk-system-a-1111'
    });
    const sysB=await createConnection(admin,{
      name:'System B',preset:'deepseek',defaultModel:'deepseek-b',apiKey:'ds-system-b-2222'
    });
    const t1Conn=await createConnection(t1,{
      name:'Teacher 1',preset:'openai',defaultModel:'gpt-teacher',apiKey:'sk-teacher-3333'
    });
    const t2Conn=await createConnection(t2,{
      name:'Teacher 2',preset:'deepseek',defaultModel:'deepseek-teacher2',apiKey:'ds-t2-4444'
    });

    const systemRoute=await setSystemRoute(admin,{
      agentType:'patient',connectionId:sysA.id,model:'gpt-a',config:{temperature:0.4}
    });
    const inherited=await resolveAgentRoutes({caseId:'aphasia_001'});

    const caseRoute=await setCaseRoute(admin,{
      caseId:'aphasia_001',agentType:'patient',connectionId:sysB.id,model:'deepseek-b',config:{temperature:0.2}
    });
    const overridden=await resolveAgentRoutes({caseId:'aphasia_001'});

    const teacherOwnRoute=await setCaseRoute(t1,{
      caseId:'t1_case',agentType:'patient',connectionId:t1Conn.id,model:'gpt-teacher',config:{temperature:0.5}
    });

    let teacherSystemError='';
    try{await setSystemRoute(t1,{agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'});}
    catch(error){teacherSystemError=error.code||error.message;}

    let teacherBuiltinError='';
    try{await setCaseRoute(t1,{caseId:'aphasia_001',agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'});}
    catch(error){teacherBuiltinError=error.code||error.message;}

    let teacherOtherCaseError='';
    try{await setCaseRoute(t1,{caseId:'t2_case',agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'});}
    catch(error){teacherOtherCaseError=error.code||error.message;}

    let teacherOtherConnectionError='';
    try{await setCaseRoute(t1,{caseId:'t1_case',agentType:'coach',connectionId:t2Conn.id,model:'deepseek-teacher2'});}
    catch(error){teacherOtherConnectionError=error.code||error.message;}

    const session=await createInterviewSession({
      user:student,caseId:'aphasia_001',mode:'training',coachEnabled:false
    });
    const storedBefore=await getOwnedSession(session.id,student);
    const snapshotBefore=typeof storedBefore.llm_route_snapshot==='string'
      ?JSON.parse(storedBefore.llm_route_snapshot):storedBefore.llm_route_snapshot;

    await deleteRoute(admin,caseRoute.id);
    await setSystemRoute(admin,{
      agentType:'patient',connectionId:sysA.id,model:'gpt-a-new-default',config:{temperature:0.9}
    });
    const resolvedAfterChange=await resolveAgentRoutes({caseId:'aphasia_001'});
    const storedAfter=await getOwnedSession(session.id,student);
    const snapshotAfter=typeof storedAfter.llm_route_snapshot==='string'
      ?JSON.parse(storedAfter.llm_route_snapshot):storedAfter.llm_route_snapshot;

    await deleteRoute(admin,systemRoute.id);
    process.env.APP_ENV='production';
    let missingProviderError='';
    try{
      await createInterviewSession({
        user:student,caseId:'t2_case',mode:'training',coachEnabled:false
      });
    }catch(error){missingProviderError=error.code||error.message;}

    console.log(JSON.stringify({
      systemRoute,inherited,caseRoute,overridden,teacherOwnRoute,
      teacherSystemError,teacherBuiltinError,teacherOtherCaseError,teacherOtherConnectionError,
      snapshotBefore,snapshotAfter,resolvedAfterChange,missingProviderError,
      snapshotContainsSecret:/apiKey|encrypted|ciphertext|secret/i.test(JSON.stringify(snapshotBefore))
    }));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,LLM_SECRET_KEY_PATH:keyPath},
    encoding:'utf8',
    timeout:30000
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.inherited.patient.connectionId,data.systemRoute.connectionId);
    assert.equal(data.inherited.patient.model,'gpt-a');
    assert.equal(data.overridden.patient.connectionId,data.caseRoute.connectionId);
    assert.equal(data.overridden.patient.model,'deepseek-b');

    assert.equal(data.teacherOwnRoute.scopeType,'case');
    assert.equal(data.teacherOwnRoute.scopeId,'t1_case');
    assert.equal(data.teacherSystemError,'FORBIDDEN');
    assert.equal(data.teacherBuiltinError,'FORBIDDEN_CASE');
    assert.equal(data.teacherOtherCaseError,'FORBIDDEN_CASE');
    assert.equal(data.teacherOtherConnectionError,'FORBIDDEN_CONNECTION');

    assert.equal(data.snapshotBefore.patient.connectionId,data.caseRoute.connectionId);
    assert.equal(data.snapshotBefore.patient.model,'deepseek-b');
    assert.equal(data.snapshotContainsSecret,false);

    assert.deepEqual(data.snapshotAfter,data.snapshotBefore);
    assert.equal(data.resolvedAfterChange.patient.connectionId,data.systemRoute.connectionId);
    assert.equal(data.resolvedAfterChange.patient.model,'gpt-a-new-default');

    assert.equal(data.missingProviderError,'AI_PROVIDER_NOT_CONFIGURED');

    const serialized=JSON.stringify(snapshotAgentShape(data.snapshotBefore));
    assert.equal(/apiKey|encrypted|ciphertext|secret/i.test(serialized),false);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

function snapshotAgentShape(snapshot){
  return {
    patient:snapshot.patient,
    coach:snapshot.coach,
    evaluator:snapshot.evaluator
  };
}
