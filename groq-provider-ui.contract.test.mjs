import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('AI settings exposes GroqCloud as a first-class preset',()=>{
  const app=readFileSync('formal-app.js','utf8');

  assert.match(app,/\['groq','GroqCloud'\]/);
  assert.match(app,/\['openai','deepseek','groq','ollama_cloud','dify'\]\.includes\(preset\)/);
  assert.match(app,/groq:'例如：openai\/gpt-oss-120b 或 openai\/gpt-oss-20b'/);
  assert.match(app,/GroqCloud 使用固定官方端點，不需填 Base URL/);
});

test('Groq preset does not expose editable Base URL',()=>{
  const app=readFileSync('formal-app.js','utf8');

  assert.match(app,/const showBase=\['ollama','dify'\]\.includes\(preset\)\|\|\(state\.user\?\.role==='admin'&&preset==='custom'\)/);
  assert.doesNotMatch(app,/\['ollama','dify','groq'\]\.includes\(preset\)/);
});

test('Vercel demo advertises Groq while keeping production AI Settings read-only',()=>{
  const demo=readFileSync('api/demo.js','utf8');

  assert.match(demo,/const GROQ_BASE_URL='https:\/\/api\.groq\.com\/openai\/v1'/);
  assert.match(demo,/name:'Demo GroqCloud'/);
  assert.match(demo,/preset:'groq'/);
  assert.match(demo,/baseUrl:GROQ_BASE_URL/);
  assert.match(demo,/VERCEL_DEMO_READ_ONLY/);
  assert.match(demo,/route==='groq-test'/);
});
