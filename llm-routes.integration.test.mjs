import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('LLM routes support teacher-owned built-in overrides without cross-teacher collisions',()=>{
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
      setSystemRoute,setCaseRoute,deleteRoute,resolveAgentRoutes,listVisibleRoutes
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
      name:'System B',preset:'deepseek',defaultModel:'deepseek-flash',apiKey:'ds-system-b-2222'
    });
    const t1Conn=await createConnection(t1,{
      name:'Teacher 1',preset:'openai',defaultModel:'gpt-teacher',apiKey:'sk-teacher-3333'
    });
    const t2Conn=await createConnection(t2,{
      name:'Teacher 2',preset:'deepseek',defaultModel:'deepseek-flash',apiKey:'ds-t2-4444'
    });

    const systemRoute=await setSystemRoute(admin,{
      agentType:'patient',connectionId:sysA.id,model:'gpt-a',config:{temperature:0.4}
    });
    const globalCaseRoute=await setCaseRoute(admin,{
      caseId:'aphasia_001',agentType:'patient',connectionId:sysB.id,model:'deepseek-flash',config:{temperature:0.2}
    });

    const teacherBuiltinT1=await setCaseRoute(t1,{
      caseId:'aphasia_001',agentType:'patient',connectionId:t1Conn.id,model:'gpt-teacher',config:{temperature:0.5}
    });
    const teacherBuiltinT2=await setCaseRoute(t2,{
      caseId:'aphasia_001',agentType:'patient',connectionId:t2Conn.id,model:'deepseek-flash',config:{temperature:0.3}
    });
    const teacherOwnRoute=await setCaseRoute(t1,{
      caseId:'t1_case',agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'
    });

    const globalResolved=await resolveAgentRoutes({caseId:'aphasia_001'});
    const t1Resolved=await resolveAgentRoutes({caseId:'aphasia_001',routeOwnerUserId:t1.id});
    const t2Resolved=await resolveAgentRoutes({caseId:'aphasia_001',routeOwnerUserId:t2.id});

    let teacherSystemError='';
    try{await setSystemRoute(t1,{agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'});}
    catch(error){teacherSystemError=error.code||error.message;}

    let teacherOtherCaseError='';
    try{await setCaseRoute(t1,{caseId:'t2_case',agentType:'coach',connectionId:t1Conn.id,model:'gpt-teacher'});}
    catch(error){teacherOtherCaseError=error.code||error.message;}

    let teacherOtherConnectionError='';
    try{await setCaseRoute(t1,{caseId:'aphasia_001',agentType:'coach',connectionId:t2Conn.id,model:'deepseek-flash'});}
    catch(error){teacherOtherConnectionError=error.code||error.message;}

    const teacherSession=await createInterviewSession({
      user:t1,caseId:'aphasia_001',mode:'training',coachEnabled:false
    });
    const teacherStored=await getOwnedSession(teacherSession.id,t1);
    const teacherSnapshot=typeof teacherStored.llm_route_snapshot==='string'
      ?JSON.parse(teacherStored.llm_route_snapshot):teacherStored.llm_route_snapshot;

    const studentSession=await createInterviewSession({
      user:student,caseId:'aphasia_001',mode:'training',coachEnabled:false
    });
    const studentStored=await getOwnedSession(studentSession.id,student);
    const studentSnapshot=typeof studentStored.llm_route_snapshot==='string'
      ?JSON.parse(studentStored.llm_route_snapshot):studentStored.llm_route_snapshot;

    const teacherVisible=await listVisibleRoutes(t1);

    await deleteRoute(t1,teacherBuiltinT1.id);
    const t1AfterDelete=await resolveAgentRoutes({caseId:'aphasia_001',routeOwnerUserId:t1.id});

    await deleteRoute(admin,globalCaseRoute.id);
    await setSystemRoute(admin,{
      agentType:'patient',connectionId:sysA.id,model:'gpt-a-new-default',config:{temperature:0.9}
    });
    const globalAfterChange=await resolveAgentRoutes({caseId:'aphasia_001'});
    const teacherStoredAfter=await getOwnedSession(teacherSession.id,t1);
    const teacherSnapshotAfter=typeof teacherStoredAfter.llm_route_snapshot==='string'
      ?JSON.parse(teacherStoredAfter.llm_route_snapshot):teacherStoredAfter.llm_route_snapshot;

    await deleteRoute(admin,systemRoute.id);
    process.env.APP_ENV='production';
    let missingProviderError='';
    try{
      await createInterviewSession({
        user:student,caseId:'t2_case',mode:'training',coachEnabled:false
      });
    }catch(error){missingProviderError=error.code||error.message;}

    console.log(JSON.stringify({
      systemRoute,globalCaseRoute,teacherBuiltinT1,teacherBuiltinT2,teacherOwnRoute,
      globalResolved,t1Resolved,t2Resolved,t1AfterDelete,globalAfterChange,
      teacherSystemError,teacherOtherCaseError,teacherOtherConnectionError,
      teacherSnapshot,studentSnapshot,teacherSnapshotAfter,teacherVisible,missingProviderError,
      snapshotContainsSecret:/apiKey|encrypted|ciphertext|secret/i.test(JSON.stringify(teacherSnapshot))
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

    assert.equal(data.globalResolved.patient.connectionId,data.globalCaseRoute.connectionId);
    assert.equal(data.t1Resolved.patient.connectionId,data.teacherBuiltinT1.connectionId);
    assert.equal(data.t2Resolved.patient.connectionId,data.teacherBuiltinT2.connectionId);
    assert.equal(data.teacherBuiltinT1.ownerUserId,data.teacherBuiltinT1.createdBy);
    assert.equal(data.teacherBuiltinT2.ownerUserId,data.teacherBuiltinT2.createdBy);
    assert.notEqual(data.teacherBuiltinT1.ownerUserId,data.teacherBuiltinT2.ownerUserId);

    assert.equal(data.teacherOwnRoute.scopeType,'case');
    assert.equal(data.teacherOwnRoute.scopeId,'t1_case');
    assert.equal(data.teacherSystemError,'FORBIDDEN');
    assert.equal(data.teacherOtherCaseError,'FORBIDDEN_CASE');
    assert.equal(data.teacherOtherConnectionError,'FORBIDDEN_CONNECTION');

    assert.equal(data.teacherSnapshot.patient.connectionId,data.teacherBuiltinT1.connectionId);
    assert.equal(data.studentSnapshot.patient.connectionId,data.globalCaseRoute.connectionId);
    assert.equal(data.snapshotContainsSecret,false);

    assert.equal(data.t1AfterDelete.patient.connectionId,data.globalCaseRoute.connectionId);
    assert.deepEqual(data.teacherSnapshotAfter,data.teacherSnapshot);
    assert.equal(data.globalAfterChange.patient.connectionId,data.systemRoute.connectionId);
    assert.equal(data.globalAfterChange.patient.model,'gpt-a-new-default');

    const visibleIds=new Set(data.teacherVisible.map(route=>route.id));
    assert.equal(visibleIds.has(data.teacherBuiltinT1.id),true);
    assert.equal(visibleIds.has(data.teacherBuiltinT2.id),false);
    assert.equal(visibleIds.has(data.systemRoute.id),true);

    assert.equal(data.missingProviderError,'AI_PROVIDER_NOT_CONFIGURED');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
