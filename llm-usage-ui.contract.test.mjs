import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('usage dashboard is production-staff only and wired to the usage API',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  assert.match(html,/data-view="usage"/);
  assert.match(html,/id="teacherUsage"/);
  assert.match(html,/id="usageUserSelect"/);
  assert.match(html,/id="quotaForm"/);

  assert.match(app,/document\.querySelector\('\[data-view="usage"\]'\)\.classList\.toggle\('hidden',!state\.serverMode\|\|!staff\)/);
  assert.match(app,/async function renderUsageDashboard\(\)\{\s*if\(!state\.serverMode\|\|!\['teacher','admin'\]\.includes\(state\.user\?\.role\)\)return;/);
  assert.match(app,/fetch\('\/api\/teacher\/llm-usage\?'/);
});

test('dashboard surfaces persisted cost and unpriced usage separately',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  assert.match(html,/id="usageCost"/);
  assert.match(html,/id="usageCostTwd"/);
  assert.match(html,/id="usageFxSummary"/);
  assert.match(html,/id="usageFxRate"/);
  assert.match(html,/id="usageUnpriced"/);
  assert.match(html,/id="usagePartial"/);
  assert.match(app,/estimatedCostMicrousd/);
  assert.match(app,/estimatedCostMicrontd/);
  assert.match(app,/function microntdToTwd/);
  assert.match(app,/action:'setFxRate'/);
  assert.match(app,/unpricedCalls/);
  assert.match(app,/partialPricingCalls/);
  assert.match(app,/usageRows\('日期',data\.byDate,'date'\)/);
  assert.match(app,/function microusdToUsd/);
});

test('quota editor follows Teacher/Admin management scope',()=>{
  const app=readFileSync('formal-app.js','utf8');

  assert.match(app,/if\(state\.user\?\.role==='admin'\)return true/);
  assert.match(app,/state\.user\?\.role==='teacher'&&user\.role==='student'&&user\.id!==state\.user\?\.id/);
  assert.match(app,/action:'setQuota'/);
  assert.match(app,/dailyCostLimitMicrousd/);
  assert.match(app,/monthlyCostLimitMicrousd/);
});

test('Vercel/browser demo cannot enter usage dashboard API path',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/if\(!state\.serverMode\|\|!\['teacher','admin'\]\.includes\(state\.user\?\.role\)\)return/);
});
