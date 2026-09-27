import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('evaluation audit UI exposes safe IDs and staff-only on-demand ZIP export',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');
  const css=readFileSync('formal.css','utf8');

  assert.match(html,/id="resultAuditMeta"/);
  assert.match(html,/id="recordEvaluationAudit"/);
  assert.match(html,/id="recordEvaluationAuditMeta"/);
  assert.match(html,/id="recordEvaluationAuditSelect"/);
  assert.match(html,/id="downloadRecordEvaluationAuditBtn"/);
  assert.match(html,/下載所選技術診斷包（ZIP）/);

  assert.match(app,/function evaluationAuditStatusLabel/);
  assert.match(app,/SUCCESS · NORMALIZED/);
  assert.match(app,/SUCCESS · REPAIRED/);
  assert.match(app,/Evaluation ID：/);
  assert.match(app,/function evaluationAuditFiles/);
  assert.match(app,/canonical_evaluation\.json/);
  assert.match(app,/normalization\.json/);
  assert.match(app,/raw_ai_response\.txt/);
  assert.match(app,/repaired_ai_response\.txt/);
  assert.match(app,/\/api\/teacher\/evaluation-audits\?evaluationId=/);
  assert.match(app,/function selectedRecordAuditSummary/);
  assert.match(app,/evaluationAudits/);
  assert.match(app,/recordEvaluationAuditSelect/);
  assert.match(app,/function downloadSelectedEvaluationAudit/);

  assert.match(css,/\.evaluation-audit-meta/);
  assert.match(css,/\.record-evaluation-audit/);
});
