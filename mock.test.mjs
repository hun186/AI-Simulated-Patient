import test from 'node:test';
import assert from 'node:assert/strict';
import { mockPatientReply } from './lib/mock-patient.js';
import { mockEvaluate } from './lib/mock-evaluator.js';

test('does not dump unrelated case facts for a greeting', () => {
  const out = mockPatientReply({ caseId:'aphasia_001', message:'你好', revealedFactIds:[] });
  assert.equal(out.revealedFactIds.length, 0);
  assert.match(out.reply, /你好/);
});

test('reveals stroke history only when asked about it', () => {
  const out = mockPatientReply({ caseId:'aphasia_001', message:'以前有中風或其他重大病史嗎？', revealedFactIds:[] });
  assert.ok(out.revealedFactIds.includes('stroke_history'));
  assert.match(out.reply, /兩年前/);
});

test('evaluation gives points for revealed facts and misses others', () => {
  const out = mockEvaluate({
    caseId:'aphasia_001',
    transcript:[{ role:'student', content:'以前有中風嗎？' }],
    revealedFactIds:['stroke_history']
  });
  assert.equal(out.totalScore, 15);
  assert.equal(out.maxScore, 100);
  assert.equal(out.items.find((x) => x.id === 'history').status, 'covered');
});

test('teacher-created case can chat and score without server persistence', () => {
  const custom = {
    id:'custom_swallow',
    title:'吞嚥困難',
    publicBrief:'吞嚥問診',
    patient:{ name:'林女士', age:72, gender:'女', persona:'' },
    opening:'最近吃東西有點不順。',
    facts:[{ id:'liquid', label:'喝水嗆咳', value:'喝水時常會嗆到。', triggers:['喝水','嗆'], mayVolunteer:false }],
    rubric:[{ id:'liquid_check', label:'詢問液體吞嚥', factIds:['liquid'], points:20 }]
  };
  const chat = mockPatientReply({ caseId:'custom_swallow', caseDefinition:custom, message:'喝水會嗆到嗎？' });
  assert.ok(chat.revealedFactIds.includes('liquid'));
  const score = mockEvaluate({ caseId:'custom_swallow', caseDefinition:custom, transcript:[{role:'student',content:'喝水會嗆到嗎？'}], revealedFactIds:chat.revealedFactIds });
  assert.equal(score.totalScore, 20);
  assert.equal(score.percentage, 100);
});
