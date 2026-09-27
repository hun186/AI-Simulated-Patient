import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationAudit,projectEvaluationAudit,evaluationAuditSummary } from './lib/evaluation-audit.js';

test('evaluation audit retains redacted evaluator evidence and deterministic normalization metadata',()=>{
  const now=new Date('2026-09-27T12:00:00.000Z');
  const result={
    text:'{"note":"Authorization: Bearer abcdefghijklmnop","totalScore":25}',
    provider:'openai_compatible',preset:'deepseek',model:'deepseek-flash',
    providerRequestId:'req-1',latencyMs:321,
    usageStatus:'reported',usage:{inputTokens:100,outputTokens:50,totalTokens:150},
    normalization:{
      applied:true,
      actions:[
        {type:'evidence_string_to_object',itemId:'chief',evidenceIndex:0,turn:2},
        {type:'aggregate_score_recomputed',from:{totalScore:25,maxScore:100,percentage:25},to:{totalScore:28,maxScore:100,percentage:28}}
      ]
    }
  };
  const canonical={
    totalScore:28,maxScore:100,percentage:28,items:[],
    overall:{comment:'ok',strengths:[],improvements:[],recommendations:[],nextPracticeFocus:'next'}
  };
  const audit=buildEvaluationAudit({
    session:{id:'s1',case_id:'c1',case_snapshot:JSON.stringify({studentLabel:'案例 A',internalTitle:'SECRET TITLE'}),mode:'exam'},
    user:{id:'student-secret',role:'student'},
    route:{connectionId:'conn1',preset:'deepseek',model:'deepseek-flash',config:{promptTemplate:'DO NOT STORE',apiKey:'SECRET'}},
    status:'success_normalized',initialResult:result,canonicalEvaluation:canonical,now
  });

  assert.match(audit.evaluationId,/^EVL-20260927-[A-F0-9]{8}$/);
  assert.equal(audit.status,'success_normalized');
  assert.equal(audit.retentionDays,90);
  assert.equal((new Date(audit.expiresAt)-now)/(24*60*60*1000),90);
  assert.equal(audit.normalization.applied,true);
  assert.equal(audit.normalization.initial.actions.length,2);
  assert.equal(audit.canonicalEvaluation.totalScore,28);
  assert.equal(audit.attempts.initial.responseText.includes('abcdefghijklmnop'),false);
  assert.match(audit.attempts.initial.responseText,/\[REDACTED\]/);
  const serialized=JSON.stringify(audit);
  assert.equal(serialized.includes('DO NOT STORE'),false);
  assert.equal(serialized.includes('SECRET TITLE'),false);
  assert.equal(serialized.includes('student-secret'),false);

  audit.storage={persisted:true};
  const student=projectEvaluationAudit(audit,{role:'student'});
  assert.equal(student.access.rawResponsesIncluded,false);
  assert.equal(student.access.canonicalEvaluationIncluded,false);
  assert.equal(student.attempts.initial.responseText,'');
  assert.equal(student.canonicalEvaluation,null);
  assert.equal('connectionId' in student.evaluatorRoute,false);

  const teacher=projectEvaluationAudit(audit,{role:'teacher'});
  assert.equal(teacher.access.rawResponsesIncluded,true);
  assert.equal(teacher.canonicalEvaluation.totalScore,28);
  assert.match(teacher.access.staffLookupPath,/evaluation-audits\?evaluationId=EVL-/);

  const summary=evaluationAuditSummary(audit);
  assert.equal(summary.status,'success_normalized');
  assert.equal(summary.normalizationApplied,true);
  assert.equal(summary.normalizationCount,2);
  assert.deepEqual(summary.normalizationTypes,['evidence_string_to_object','aggregate_score_recomputed']);
  assert.equal(summary.repairUsed,false);
});

test('failed audit uses the same EVL identifier as its support error id',()=>{
  const err=new Error('item.evidence');
  err.code='INVALID_EVALUATION_CONTRACT';
  err.llmResult={text:'bad',provider:'openai_compatible',preset:'deepseek',model:'deepseek-flash'};
  const repair=new Error('item.evidence');
  repair.code='EVALUATION_REPAIR_FAILED';
  repair.llmResult={text:'still bad',provider:'openai_compatible',preset:'deepseek',model:'deepseek-flash'};
  const audit=buildEvaluationAudit({
    session:{id:'s2',case_id:'c2',mode:'training'},user:{role:'student'},
    route:{preset:'deepseek',model:'deepseek-flash'},status:'failed',
    initialError:err,repairError:repair,now:new Date('2026-09-27T12:10:00.000Z')
  });
  assert.equal(audit.errorId,audit.evaluationId);
  assert.equal(audit.repairUsed,true);
  assert.equal(audit.attempts.initial.validation.code,'INVALID_EVALUATION_CONTRACT');
  assert.equal(audit.attempts.repair.validation.code,'EVALUATION_REPAIR_FAILED');
});
