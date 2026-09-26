import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Teacher Console AI Settings UI exposes provider and agent routing controls only behind server-mode guard',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  assert.match(html,/data-view="ai"/);
  assert.match(html,/id="teacherAiSettings"/);
  assert.match(html,/id="aiConnectionForm"/);
  assert.match(html,/id="aiApiKey" type="password"/);
  assert.match(html,/id="aiRouteGrid"/);

  assert.match(app,/document\.querySelector\('\[data-view="ai"\]'\)\.classList\.toggle\('hidden',!state\.serverMode\|\|!staff\)/);
  assert.match(app,/async function renderAiSettings\(\)\{\s*if\(!state\.serverMode\|\|!\['teacher','admin'\]\.includes\(state\.user\?\.role\)\)return;/);
  assert.match(app,/fetch\('\/api\/teacher\/ai-settings'\)/);
});

test('AI Settings respects provider scope and keeps stored keys masked/write-only',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const api=readFileSync('api/teacher/ai-settings.js','utf8');
  const connections=readFileSync('lib/llm/connections.js','utf8');

  assert.match(app,/\?\[\['openai','OpenAI'\],\['deepseek','DeepSeek'\],\['ollama','Ollama'\],\['custom','OpenAI-compatible \/ Custom'\]\]/);
  assert.match(app,/:\[\['openai','OpenAI'\],\['deepseek','DeepSeek'\]\]/);
  assert.match(app,/connection\.apiKeyLast4\?'••••'/);
  assert.match(app,/data-ai-edit/);
  assert.match(app,/data-ai-toggle/);
  assert.match(app,/action:'updateConnection'/);
  assert.doesNotMatch(app,/encrypted_api_key|api_key_iv|api_key_tag/);
  assert.match(connections,/actor\.role===ROLE_TEACHER && !rules\.teacherAllowed/);
  assert.match(connections,/apiKeyLast4:row\.api_key_last4/);
  assert.doesNotMatch(api,/encrypted_api_key|api_key_iv|api_key_tag/);
});

test('Patient Coach and Evaluator have separate configurable route selectors',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/\['patient','coach','evaluator'\]\.map/);
  assert.match(app,/action='setSystemRoute'|payload\.action='setSystemRoute'/);
  assert.match(app,/payload\.action='setCaseRoute'/);
  assert.match(app,/payload\.action='setCaseRoute';payload\.caseId=\$\('aiCaseSelect'\)\.value/);
});

test('Teacher AI route picker includes built-in cases plus cases owned by the signed-in Teacher',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const cases=readFileSync('lib/server-cases.js','utf8');
  assert.match(cases,/createdBy:row\.created_by\|\|null/);
  assert.match(app,/filter\(c=>!c\.createdBy\|\|c\.createdBy===state\.user\?\.id\)/);
  assert.match(app,/系統內建/);
  assert.match(app,/r\.ownerUserId===state\.user\?\.id/);
});


test('chat header shows the actual snapshotted Patient provider and model for the session',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');
  const sessions=readFileSync('lib/server-sessions.js','utf8');

  assert.match(html,/id="sessionProviderBadge"/);
  assert.match(app,/state\.sessionRuntime=d\.session\.runtime\|\|null/);
  assert.match(app,/DeepSeek/);
  assert.match(app,/Mock/);
  assert.match(app,/sessionProviderBadge/);
  assert.match(sessions,/runtime:\{/);
  assert.match(sessions,/providerKind:routeSnapshot\.patient\.providerKind/);
  assert.match(sessions,/preset:routeSnapshot\.patient\.preset/);
  assert.match(sessions,/model:routeSnapshot\.patient\.model/);
  assert.doesNotMatch(sessions,/runtime:\{[^]*apiKey/);
});
