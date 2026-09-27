import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStudentReportExportPolicy,
  canStudentExportReport
} from './lib/report-policy.js';

test('student report policy defaults to training-only',()=>{
  assert.equal(normalizeStudentReportExportPolicy(undefined),'training_only');
  assert.equal(normalizeStudentReportExportPolicy('bad-value'),'training_only');
  assert.equal(canStudentExportReport(undefined,'training'),true);
  assert.equal(canStudentExportReport(undefined,'exam'),false);
});

test('student report policy supports disabled and all-completed modes',()=>{
  assert.equal(canStudentExportReport('disabled','training'),false);
  assert.equal(canStudentExportReport('disabled','exam'),false);
  assert.equal(canStudentExportReport('all_completed','training'),true);
  assert.equal(canStudentExportReport('all_completed','exam'),true);
});
