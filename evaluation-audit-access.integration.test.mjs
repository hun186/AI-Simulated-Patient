import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('evaluation audits are retained and scoped to admin or assigned teacher',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-eval-audit-access-'));
  const dbPath=join(dir,'aisp.sqlite');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='development';

    const {query}=await import('./lib/db.js');
    const {createInterviewSession}=await import('./lib/server-sessions.js');
    const {saveEvaluationAudit,getEvaluationAuditForActor,getLatestEvaluationAuditSummaries}=await import('./lib/evaluation-audit-store.js');

    const users=[
      ['admin-1','admin@example.test','Admin','admin'],
      ['teacher-1','teacher@example.test','Teacher','teacher'],
      ['teacher-2','other@example.test','Other','teacher'],
      ['student-1','student@example.test','Student','student']
    ];
    for(const [id,email,name,role] of users){
      await query(
        'insert into app_users (id,email,display_name,role,password_salt,password_hash,is_active,account_status) values ($1,$2,$3,$4,$5,$6,true,$7)',
        [id,email,name,role,'salt','hash','active']
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
    const audit={
      schemaVersion:1,evaluationId:'EVL-20260927-AUDIT001',errorId:null,category:'evaluation_audit',
      status:'success_normalized',occurredAt:'2026-09-27T12:20:00.000Z',
      expiresAt:'2026-12-26T12:20:00.000Z',retentionDays:90,repairUsed:false,
      session:{id:session.id,caseId:'aphasia_001',mode:'exam',userRole:'student'},
      attempts:{initial:{responseText:'raw evaluator',provider:'openai_compatible',preset:'deepseek',model:'deepseek-flash',validation:{code:null,message:''}},repair:null},
      normalization:{applied:true,initial:{applied:true,actions:[{type:'aggregate_score_recomputed'}]},repair:{applied:false,actions:[]}},
      canonicalEvaluation:{totalScore:28,maxScore:100,percentage:28,items:[],overall:{comment:'ok',strengths:[],improvements:[],recommendations:[],nextPracticeFocus:'next'}},
      security:{redactionApplied:true},storage:{persisted:true}
    };
    await saveEvaluationAudit({audit,sessionId:session.id,studentUserId:'student-1'});

    const admin=await getEvaluationAuditForActor(audit.evaluationId,{id:'admin-1',role:'admin'});
    const assigned=await getEvaluationAuditForActor(audit.evaluationId,{id:'teacher-1',role:'teacher'});
    const outsider=await getEvaluationAuditForActor(audit.evaluationId,{id:'teacher-2',role:'teacher'});
    const student=await getEvaluationAuditForActor(audit.evaluationId,{id:'student-1',role:'student'});
    const summaries=await getLatestEvaluationAuditSummaries([session.id]);

    console.log(JSON.stringify({
      admin,assigned,outsider,student,summary:summaries.get(session.id)||null
    }));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'development'},
    encoding:'utf8',timeout:30000
  });
  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.admin.audit.attempts.initial.responseText,'raw evaluator');
    assert.equal(data.assigned.audit.canonicalEvaluation.totalScore,28);
    assert.equal(data.outsider,null);
    assert.equal(data.student,null);
    assert.equal(data.summary.evaluationId,'EVL-20260927-AUDIT001');
    assert.equal(data.summary.status,'success_normalized');
    assert.equal(data.summary.normalizationCount,1);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
