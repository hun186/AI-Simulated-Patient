import test from 'node:test';
import assert from 'node:assert/strict';
import { mockPatientReply } from './lib/mock-patient.js';
import { mockEvaluate } from './lib/mock-evaluator.js';

test('does not dump unrelated case facts for a greeting', () => {
  const out = mockPatientReply({ caseId: 'aphasia_001', message: '你好', revealedFactIds: [] });
  assert.equal(out.revealedFactIds.length, 0);
  assert.match(out.reply, /你好/);
});

test('reveals stroke history only when asked about it', () => {
  const out = mockPatientReply({ caseId: 'aphasia_001', message: '以前有中風或其他重大病史嗎？', revealedFactIds: [] });
  assert.ok(out.revealedFactIds.includes('stroke_history'));
  assert.match(out.reply, /兩年前/);
});

test('evaluation gives points for revealed facts and misses others', () => {
  const out = mockEvaluate({
    caseId: 'aphasia_001',
    transcript: [{ role: 'student', content: '以前有中風嗎？' }],
    revealedFactIds: ['stroke_history']
  });
  assert.equal(out.totalScore, 15);
  assert.equal(out.maxScore, 100);
  assert.equal(out.items.find((x) => x.id === 'history').status, 'covered');
  assert.equal(out.items.find((x) => x.id === 'chief').status, 'missed');
});
