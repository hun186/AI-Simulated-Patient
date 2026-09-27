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
  assert.match(app,/usageRows\('日期（本地）',data\.byDate,'date'\)/);
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


test('dashboard surfaces cache hit rate and historical savings without treating missing telemetry as zero hits',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');
  assert.match(html,/id="usageCacheHitTokens"/);
  assert.match(html,/id="usageCacheHitRate"/);
  assert.match(html,/id="usageCacheSavings"/);
  assert.match(html,/id="usageCacheSavingsTwd"/);
  assert.match(app,/function cacheRate/);
  assert.match(app,/Cache telemetry 未回報/);
  assert.match(app,/cacheReportedCalls/);
  assert.match(app,/cachedInputTokens/);
  assert.match(app,/cacheMissTokens/);
  assert.match(app,/cacheSavingsMicrousd/);
});


test('usage analytics exposes time, dimensional, outcome and cache filters',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  for(const id of [
    'usagePeriod','usageFromDate','usageToDate','usageUserSelect','usageProvider','usageModel',
    'usageAgent','usageCase','usageOutcome','usageCacheStatus','usageFilterResetBtn'
  ]) assert.match(html,new RegExp('id="'+id+'"'));

  assert.match(html,/value="today"/);
  assert.match(html,/value="week"/);
  assert.match(html,/value="month"/);
  assert.match(html,/value="7d"/);
  assert.match(html,/value="30d"/);
  assert.match(html,/value="custom"/);
  assert.match(html,/value="all"/);

  assert.match(app,/function usagePeriodRange/);
  assert.match(app,/timeZoneOffsetMinutes:String\(new Date\(\)\.getTimezoneOffset\(\)\)/);
  assert.match(app,/provider:\$\('usageProvider'\)\.value/);
  assert.match(app,/model:\$\('usageModel'\)\.value/);
  assert.match(app,/agentType:\$\('usageAgent'\)\.value/);
  assert.match(app,/caseId:\$\('usageCase'\)\.value/);
  assert.match(app,/for\(const \[key,value\] of Object\.entries\(values\)\)if\(value\)params\.set\(key,value\)/);
  assert.match(app,/params\.set\('outcome'/);
  assert.match(app,/params\.set\('cacheStatus'/);
  assert.match(app,/usageRows\('使用者'/);
  assert.match(app,/usageRows\('病例'/);
});

test('cache KPI distinguishes hit rate from telemetry coverage',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  assert.match(html,/id="usageCacheCoverage"/);
  assert.match(html,/id="usageCacheCoverageDetail"/);
  assert.match(html,/id="usageCacheRateDetail"/);
  assert.match(app,/cacheReportedInputTokens/);
  assert.match(app,/部分歷史\/Provider 未回報/);
  assert.match(app,/usageCacheCoverage/);
  assert.match(app,/usageCacheRateDetail/);
});

test('usage date presets use local calendar boundaries before converting to ISO',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/new Date\(now\.getFullYear\(\),now\.getMonth\(\),now\.getDate\(\)\+1\)/);
  assert.match(app,/from\.toISOString\(\)/);
  assert.match(app,/to\.toISOString\(\)/);
  assert.match(app,/日期（本地）/);
});
