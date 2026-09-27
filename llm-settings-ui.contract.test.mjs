import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Teacher Console AI Settings UI exposes provider and agent routing controls in server mode or Vercel demo preview',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');

  assert.match(html,/data-view="ai"/);
  assert.match(html,/id="teacherAiSettings"/);
  assert.match(html,/id="aiConnectionForm"/);
  assert.match(html,/id="aiApiKey" type="password"/);
  assert.match(html,/id="aiRouteGrid"/);

  assert.match(app,/document\.querySelector\('\[data-view="ai"\]'\)\.classList\.toggle\('hidden',\(!state\.serverMode&&!state\.demoAuth\)\|\|!staff\)/);
  assert.match(app,/async function renderAiSettings\(\)\{\s*if\(!state\.serverMode\|\|!\['teacher','admin'\]\.includes\(state\.user\?\.role\)\)return;/);
  assert.match(app,/fetch\('\/api\/teacher\/ai-settings'\)/);
});

test('AI Settings respects provider scope and keeps stored keys masked/write-only',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const api=readFileSync('api/teacher/ai-settings.js','utf8');
  const connections=readFileSync('lib/llm/connections.js','utf8');

  assert.match(app,/\['ollama_cloud','Ollama Cloud'\]/);
  assert.match(app,/\['ollama','Ollama Local'\]/);
  assert.match(app,/Teacher 可建立自己的 OpenAI、DeepSeek、Ollama Cloud 與 Ollama Local/);
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
  assert.match(app,/payload\.action='setCaseRoute';payload\.caseId=caseId/);
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


test('runtime UI explains missing Evaluator routes and evaluation provider failures',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/AI_EVALUATOR_PROVIDER_NOT_CONFIGURED/);
  assert.match(app,/Evaluator AI/);
  assert.match(app,/invalid_response/);
  assert.match(app,/INVALID_EVALUATION_CONTRACT/);
  assert.match(app,/evaluationErrorMessage/);
});


test('Ollama Cloud is API-key based while Ollama Local keeps its local endpoint workflow',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const connections=readFileSync('lib/llm/connections.js','utf8');
  assert.match(app,/\['openai','deepseek','ollama_cloud'\]\.includes\(preset\)/);
  assert.match(app,/deepseek-v4-pro 或 deepseek-v4\.1-flash/);
  assert.match(connections,/ollama_cloud:\{providerKind:'openai_compatible',baseUrl:'https:\/\/ollama\.com\/v1'/);
  assert.match(connections,/storedPreset:'ollama'/);
});


test('AI Settings exposes safe customizable Patient Coach Evaluator and Final Feedback prompt templates',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const api=readFileSync('api/teacher/ai-settings.js','utf8');
  const prompts=readFileSync('lib/llm/prompts.js','utf8');
  const routes=readFileSync('lib/llm/routes.js','utf8');

  assert.match(app,/function promptTemplateEditor/);
  assert.match(app,/data-prompt-key/);
  assert.match(app,/系統鎖定規則（唯讀）/);
  assert.match(prompts,/Final Feedback/);
  assert.match(app,/儲存 Provider \/ Model \/ Prompt/);
  assert.match(app,/config\[field\.dataset\.promptKey\]=field\.value\.trim\(\)/);
  assert.match(api,/promptTemplates:getPromptTemplateCatalog\(\)/);
  assert.match(prompts,/feedbackTemplate/);
  assert.match(prompts,/PROMPT_TEMPLATE_MAX_CHARS=8000/);
  assert.match(prompts,/UNSUPPORTED_PROMPT_VARIABLE/);
  assert.match(routes,/validatePromptTemplate/);
});


test('Teacher AI Settings includes free Ollama Local while arbitrary Custom endpoints remain Admin-only',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const connections=readFileSync('lib/llm/connections.js','utf8');
  assert.match(app,/:\[\['openai','OpenAI'\],\['deepseek','DeepSeek'\],\['ollama_cloud','Ollama Cloud'\],\['ollama','Ollama Local（OpenAI 相容端點）'\]\]/);
  assert.match(app,/Teacher 可建立自己的 OpenAI、DeepSeek、Ollama Cloud 與 Ollama Local/);
  assert.match(connections,/ollama:\{providerKind:'openai_compatible',baseUrl:'http:\/\/127\.0\.0\.1:11434\/v1',teacherAllowed:true,keyRequired:false\}/);
  assert.match(connections,/custom:\{providerKind:'openai_compatible',baseUrl:null,teacherAllowed:false/);
});


test('Teacher can configure a private-network Ollama Local Base URL',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const connections=readFileSync('lib/llm/connections.js','utf8');
  assert.match(app,/const showBase=preset==='ollama'\|\|\(state\.user\?\.role==='admin'&&preset==='custom'\)/);
  assert.match(app,/http:\/\/192\.168\.1\.50:11434\/v1/);
  assert.match(app,/if\(preset==='ollama'\|\|\(state\.user\?\.role==='admin'&&preset==='custom'\)\)payload\.baseUrl=/);
  assert.match(app,/connection\.preset==='ollama'/);
  assert.match(connections,/normalizeOllamaLocalBaseUrl/);
  assert.match(connections,/OLLAMA_LOCAL_ENDPOINT_NOT_ALLOWED/);
  assert.match(connections,/a===10/);
  assert.match(connections,/a===192&&b===168/);
  assert.match(connections,/a===172&&b>=16&&b<=31/);
});

test('saving an empty Agent route selection restores the unconfigured fallback state',()=>{
  const app=readFileSync('formal-app.js','utf8');
  assert.match(app,/未設定（Rule-based \/ 系統預設）/);
  assert.match(app,/if\(!connectionId\)\{/);
  assert.match(app,/action:'deleteRoute',routeId:currentRoute\.id/);
  assert.match(app,/已恢復為未設定（Rule-based \/ 系統預設）/);
  assert.doesNotMatch(app,/if\(!connectionId\)return alert\('請先選擇 Provider 連線。'\)/);
});


test('Prompt template editors provide modal examples with copy and one-click apply',()=>{
  const html=readFileSync('index.html','utf8');
  const app=readFileSync('formal-app.js','utf8');
  const css=readFileSync('formal.css','utf8');
  const prompts=readFileSync('lib/llm/prompts.js','utf8');

  assert.match(html,/id="promptExampleDialog"/);
  assert.match(html,/id="promptExampleText"/);
  assert.match(html,/id="promptExampleCopyBtn"/);
  assert.match(html,/id="promptExampleApplyBtn"/);

  assert.match(app,/data-prompt-example-agent/);
  assert.match(app,/function openPromptExample/);
  assert.match(app,/function copyPromptExample/);
  assert.match(app,/function applyPromptExample/);
  assert.match(app,/promptExampleTarget\.value=\$\('promptExampleText'\)\.value/);
  assert.match(app,/navigator\.clipboard\.writeText/);

  assert.match(css,/\.prompt-example-dialog/);
  assert.match(css,/#promptExampleText/);

  assert.match(prompts,/exampleTitle:'自然、簡短、漸進揭露'/);
  assert.match(prompts,/exampleTitle:'蘇格拉底式、少量提示'/);
  assert.match(prompts,/exampleTitle:'證據導向、避免關鍵字式給分'/);
  assert.match(prompts,/exampleTitle:'鼓勵但具體的教學回饋'/);
  assert.match(prompts,/\{\{patient_name\}\}/);
  assert.match(prompts,/\{\{learning_goals\}\}/);
});


test('Vercel Demo exposes the AI settings surface as read-only without enabling production persistence',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const html=readFileSync('index.html','utf8');
  const css=readFileSync('formal.css','utf8');
  const vercel=JSON.parse(readFileSync('vercel.json','utf8'));

  assert.match(app,/data-view="ai"\]\'\)\.classList\.toggle\('hidden',\(!state\.serverMode&&!state\.demoAuth\)\|\|!staff\)/);
  assert.match(app,/function demoAiReadOnly/);
  assert.match(app,/function blockDemoAiAction/);
  assert.match(app,/Vercel Demo 僅展示 LLM Provider \/ Agent Route \/ Prompt Template/);
  assert.match(app,/if\(blockDemoAiAction\(\)\)return/);
  assert.match(app,/const demoReadOnly=Boolean\(data\.demoReadOnly\|\|state\.demoAuth\)/);
  assert.match(html,/id="aiDemoNotice"/);
  assert.match(css,/\.ai-demo-notice/);
  assert.ok(vercel.rewrites.some(item=>item.source==='/api/teacher/ai-settings'&&item.destination==='/api/demo?route=ai-settings'));
});
