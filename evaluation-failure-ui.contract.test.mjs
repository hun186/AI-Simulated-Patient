import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('evaluation repair failure exposes actionable support UI and downloadable diagnostics',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');
  const css=readFileSync('formal.css','utf8');

  assert.match(html,/id="evaluationFailureCard"/);
  assert.match(html,/id="downloadEvaluationDebugBtn"/);
  assert.match(html,/id="retryEvaluationBtn"/);
  assert.match(html,/id="evaluationRawResponse"/);
  assert.match(html,/id="evaluationRepairedResponse"/);
  assert.match(html,/提供給授課教師或系統管理員|提供支援人員/);

  assert.match(app,/function renderEvaluationFailure/);
  assert.match(app,/error\?\.details\?\.diagnostic/);
  assert.match(app,/function downloadEvaluationDiagnostic/);
  assert.match(app,/application\/json;charset=utf-8/);
  assert.match(app,/state\.user\?\.role==='student'/);
  assert.match(app,/提供給授課教師或系統管理員/);
  assert.match(app,/state\.user\?\.role==='teacher'/);
  assert.match(app,/提供給系統管理員或維運人員/);
  assert.match(app,/if\(!renderEvaluationFailure\(error\)\)alert/);

  assert.match(css,/\.evaluation-failure-card\{/);
  assert.match(css,/\.evaluation-debug-block pre\{/);
});
