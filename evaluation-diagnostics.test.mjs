import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationFailureDiagnostic,projectEvaluationFailureDiagnostic,redactDiagnosticText } from './lib/evaluation-diagnostics.js';

test('evaluation diagnostics keep useful metadata while excluding route secrets and prompt configuration',()=>{
  const initialError=new Error('items');
  initialError.code='INVALID_EVALUATION_CONTRACT';
  initialError.llmResult={
    text:'{"items":[],"note":"Authorization: Bearer abcdefghijklmnop"}',
    provider:'openai_compatible',preset:'ollama',model:'qwen-test',
    providerRequestId:'req-initial',latencyMs:123,
    usageStatus:'reported',usage:{inputTokens:10,outputTokens:20,totalTokens:30}
  };
  const repairError=new Error('overall');
  repairError.code='EVALUATION_REPAIR_FAILED';
  repairError.llmResult={
    text:'{"apiKey":"super-secret-value","overall":null}',
    provider:'openai_compatible',preset:'ollama',model:'qwen-test',
    providerRequestId:'req-repair',latencyMs:234,
    usageStatus:'reported',usage:{inputTokens:12,outputTokens:22,totalTokens:34}
  };

  const diagnostic=buildEvaluationFailureDiagnostic({
    session:{id:'session-1',case_id:'case-1',mode:'training'},
    user:{id:'student-secret-id',role:'student'},
    route:{
      connectionId:'connection-1',preset:'ollama',model:'qwen-test',
      config:{difyExecutionMode:'platform_managed',promptTemplate:'MUST_NOT_LEAK',apiKey:'MUST_NOT_LEAK'}
    },
    initialError,repairError,
    now:new Date('2026-09-27T10:00:00.000Z')
  });

  assert.match(diagnostic.errorId,/^EVL-20260927-[A-F0-9]{8}$/);
  assert.equal(diagnostic.session.id,'session-1');
  assert.equal(diagnostic.session.userRole,'student');
  assert.equal('userId' in diagnostic.session,false);
  assert.equal(diagnostic.evaluatorRoute.connectionId,'connection-1');
  assert.equal(diagnostic.evaluatorRoute.preset,'ollama');
  assert.equal(diagnostic.attempts.initial.validation.message,'items');
  assert.equal(diagnostic.attempts.repair.validation.message,'overall');
  assert.match(diagnostic.attempts.initial.responseText,/Bearer \[REDACTED\]/);
  assert.match(diagnostic.attempts.repair.responseText,/\[REDACTED\]/);
  const serialized=JSON.stringify(diagnostic);
  assert.equal(serialized.includes('MUST_NOT_LEAK'),false);
  assert.equal(serialized.includes('super-secret-value'),false);
  assert.equal(serialized.includes('student-secret-id'),false);
});

test('diagnostic redaction catches common bearer and API-key forms',()=>{
  const input='Authorization: Bearer abcdefghijklmnop api_key=xyzxyzxyzxyz password: letmein sk-1234567890abcdef';
  const output=redactDiagnosticText(input);
  assert.equal(output.includes('abcdefghijklmnop'),false);
  assert.equal(output.includes('xyzxyzxyzxyz'),false);
  assert.equal(output.includes('letmein'),false);
  assert.equal(output.includes('sk-1234567890abcdef'),false);
});


test('student projection hides evaluator text while staff projection keeps it',()=>{
  const initialError=new Error('items');
  initialError.code='INVALID_EVALUATION_CONTRACT';
  initialError.llmResult={text:'raw evaluator answer',provider:'dify',preset:'dify',model:'chat'};
  const repairError=new Error('overall');
  repairError.code='EVALUATION_REPAIR_FAILED';
  repairError.llmResult={text:'repaired evaluator answer',provider:'dify',preset:'dify',model:'chat'};
  const diagnostic=buildEvaluationFailureDiagnostic({
    session:{id:'session-2',case_id:'case-2',mode:'exam'},
    user:{role:'student'},route:{connectionId:'conn-2',preset:'dify',model:'chat'},
    initialError,repairError,now:new Date('2026-09-27T10:05:00.000Z')
  });
  diagnostic.storage={persisted:true};

  const student=projectEvaluationFailureDiagnostic(diagnostic,{role:'student'});
  assert.equal(student.access.rawResponsesIncluded,false);
  assert.equal(student.attempts.initial.responseText,'');
  assert.equal(student.attempts.initial.responseRestricted,true);
  assert.equal(student.attempts.repair.responseText,'');
  assert.match(student.access.staffLookupPath,/\/api\/teacher\/evaluation-diagnostics\?errorId=EVL-20260927-/);

  const teacher=projectEvaluationFailureDiagnostic(diagnostic,{role:'teacher'});
  assert.equal(teacher.access.rawResponsesIncluded,true);
  assert.equal(teacher.attempts.initial.responseText,'raw evaluator answer');
  assert.equal(teacher.attempts.repair.responseText,'repaired evaluator answer');

  const admin=projectEvaluationFailureDiagnostic(diagnostic,{role:'admin'});
  assert.equal(admin.access.rawResponsesIncluded,true);
});
