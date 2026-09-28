import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Vercel demo exposes a first-run Mock vs Groq Live onboarding wizard',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  for(const id of [
    'demoAiModeBtn','demoByokDialog','demoByokStep1','demoByokStep2','demoByokStep3',
    'demoByokMockBtn','demoByokSetupBtn','demoByokApiKey','demoByokModel','demoByokRemember',
    'demoByokTestBtn','demoByokEnableBtn','demoByokClearBtn','demoByokReconfigureBtn'
  ]) assert.match(html,new RegExp('id="'+id+'"'));

  assert.match(html,/你想怎麼體驗|Mock Demo/);
  assert.match(html,/使用自己的 Groq API Key/);
  assert.match(html,/sessionStorage/);
  assert.match(html,/localStorage/);
  assert.match(html,/Vercel Function/);
  assert.match(html,/https:\/\/console\.groq\.com\/keys/);

  assert.match(app,/function maybeOpenDemoByokOnboarding/);
  assert.match(app,/DEMO_BYOK_ONBOARDING_KEY/);
  assert.match(app,/openDemoByokWizard\(\)/);
});

test('BYOK key is browser-local at rest and sent only to Vercel demo AI calls',()=>{
  const app=readFileSync('formal-app.js','utf8');

  assert.match(app,/DEMO_BYOK_SESSION_KEY/);
  assert.match(app,/DEMO_BYOK_LOCAL_KEY/);
  assert.match(app,/remember\?localStorage:sessionStorage/);
  assert.match(app,/demoByok:demoByokPayload\(\)/);
  assert.match(app,/\['\/api\/chat','\/api\/coach','\/api\/evaluate'\]\.includes\(url\)/);
  assert.match(app,/post\('\/api\/demo\/groq-test'/);

  const saveFunction=app.match(/function save\(\)\{[^\n]+/s)?.[0]||'';
  assert.doesNotMatch(saveFunction,/demoByok|apiKey/);
});

test('Groq Live and Mock modes restart the local interview instead of switching provider mid-session',()=>{
  const app=readFileSync('formal-app.js','utf8');

  assert.match(app,/preset:'groq',model:state\.demoByok\.model/);
  assert.match(app,/preset:'mock',model:'deterministic-mock'/);
  assert.match(app,/async function enableDemoByok\(\)[\s\S]*await start\(\)/);
  assert.match(app,/async function clearDemoByokAndUseMock\(\)[\s\S]*await start\(\)/);
  assert.match(app,/groq:'GroqCloud'/);
});

test('production AI Settings remains separate from Vercel BYOK demo mode',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const demo=readFileSync('api/demo.js','utf8');

  assert.match(app,/正式 AI Settings 維持唯讀/);
  assert.match(demo,/VERCEL_DEMO_READ_ONLY/);
  assert.match(demo,/Live Demo 請使用頁首的 Groq BYOK 精靈/);
  assert.doesNotMatch(demo,/server-auth|server-sessions|db\.js|db-sqlite|db-postgres|better-sqlite3|neondatabase/);
});
