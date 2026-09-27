import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('stored evaluation diagnostics are admin/assigned-teacher scoped',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-eval-diagnostic-access-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='development';

    const {query}=await import('./lib/db.js');
    const {createInterviewSession}=await import('./lib/server-sessions.js');
    const {saveEvaluationFailureDiagnostic,getEvaluationFailureDiagnosticForActor}=await import('./lib/evaluation-diagnostic-store.js');

    const users=[
      ['admin-1','admin@example.test','Admin','admin'],
      ['teacher-1','teacher@example.test','Teacher','teacher'],
      ['teacher-2','other@example.test','Other','teacher'],
      ['student-1','student@example.test','Student','student']
    ];
    for(const [id,email,name,role] of users){
      await query(
        'insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values ($1,$2,$3,$4,$5,$6,true,$7)',
        [id,email,name,role,'test-salt','test-hash','active']
      );
    }
    await query(
      'insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by) values ($1,$2,$3)',
      ['teacher-1','student-1','admin-1']
    );

    const session=await createInterviewSession({
      user:{id:'student-1',role:'student',displayName:'Student'},
      caseId:'aphasia_001',mode:'exam',coachEnabled:false
    });
    const diagnostic={
      schemaVersion:1,errorId:'EVL-20260927-ACCESS01',category:'evaluation_contract_repair_failed',
      occurredAt:'2026-09-27T10:10:00.000Z',
      session:{id:session.id,caseId:'aphasia_001',mode:'exam',userRole:'student'},
      attempts:{
        initial:{responseText:'raw evaluator content',validation:{code:'INVALID_EVALUATION_CONTRACT',message:'items'}},
        repair:{responseText:'raw repaired content',validation:{code:'EVALUATION_REPAIR_FAILED',message:'overall'}}
      },
      security:{redactionApplied:true},storage:{persisted:true}
    };
    await saveEvaluationFailureDiagnostic({diagnostic,sessionId:session.id,studentUserId:'student-1'});

    const admin=await getEvaluationFailureDiagnosticForActor(diagnostic.errorId,{id:'admin-1',role:'admin'});
    const assigned=await getEvaluationFailureDiagnosticForActor(diagnostic.errorId,{id:'teacher-1',role:'teacher'});
    const outsider=await getEvaluationFailureDiagnosticForActor(diagnostic.errorId,{id:'teacher-2',role:'teacher'});
    const student=await getEvaluationFailureDiagnosticForActor(diagnostic.errorId,{id:'student-1',role:'student'});

    console.log(JSON.stringify({admin,assigned,outsider,student}));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'development'},
    encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.admin.diagnostic.attempts.initial.responseText,'raw evaluator content');
    assert.equal(data.assigned.diagnostic.attempts.repair.responseText,'raw repaired content');
    assert.equal(data.outsider,null);
    assert.equal(data.student,null);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
