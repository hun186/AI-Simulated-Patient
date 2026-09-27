import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('security audit UI uses server-side pagination and filters',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  for(const id of [
    'auditFilterForm','auditPeriod','auditFromDate','auditToDate','auditAction','auditSuccess',
    'auditActor','auditTarget','auditQuery','auditPageSize','auditFirstBtn','auditPrevBtn',
    'auditNextBtn','auditLastBtn','auditPageLabel','auditSummary'
  ]) assert.match(html,new RegExp('id="'+id+'"'));

  assert.match(app,/page:String\(auditPage\)/);
  assert.match(app,/pageSize:\$\('auditPageSize'\)\.value/);
  assert.match(app,/params\.set\('from'/);
  assert.match(app,/params\.set\('to'/);
  assert.match(app,/action:\$\('auditAction'\)\.value/);
  assert.match(app,/actorUserId:\$\('auditActor'\)\.value/);
  assert.match(app,/targetUserId:\$\('auditTarget'\)\.value/);
  assert.match(app,/q:\$\('auditQuery'\)\.value\.trim\(\)/);
  assert.match(app,/syncAuditPagination\(data\.pagination\)/);
  assert.match(app,/changeAuditPage\(auditPage\+1\)/);
});

test('security audit remains admin-only in the production UI',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/document\.querySelector\('\[data-view="audit"\]'\)\.classList\.toggle\('hidden',!state\.serverMode\|\|state\.user\?\.role!=='admin'\)/);
  assert.match(app,/async function renderSecurityAudit\(\)\{\s*if\(!state\.serverMode\|\|state\.user\?\.role!=='admin'\)return;/);
});

test('security audit date presets use local calendar boundaries converted to UTC',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/function auditPeriodRange/);
  assert.match(app,/from:from\?from\.toISOString\(\):null/);
  assert.match(app,/to:to\?to\.toISOString\(\):null/);
  assert.match(html=readFileSync('index.html','utf8'),/value="30d" selected/);
});
