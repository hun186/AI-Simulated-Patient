import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(script,env={}){
  return spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,...env},
    encoding:'utf8'
  });
}

test('LLM secret store encrypts with AES-256-GCM and never stores plaintext',()=>{
  const key=Buffer.alloc(32,7).toString('base64');
  const script=`
    process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key)};
    process.env.APP_ENV='production';
    const {encryptSecret,decryptSecret}=await import('./lib/llm/secret-store.js');
    const record=encryptSecret('sk-super-secret-1234');
    console.log(JSON.stringify({record,decrypted:decryptSecret(record)}));
  `;
  const result=run(script);
  assert.equal(result.status,0,result.stderr);
  const payload=JSON.parse(result.stdout.trim());
  assert.equal(payload.decrypted,'sk-super-secret-1234');
  assert.equal(payload.record.last4,'1234');
  assert.equal(typeof payload.record.ciphertext,'string');
  assert.equal(payload.record.ciphertext.includes('sk-super-secret-1234'),false);
  assert.ok(payload.record.iv);
  assert.ok(payload.record.tag);
});

test('LLM secret store fails closed when ciphertext is opened with the wrong master key',()=>{
  const key1=Buffer.alloc(32,3).toString('base64');
  const key2=Buffer.alloc(32,4).toString('base64');
  const create=run(`
    process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key1)};
    process.env.APP_ENV='production';
    const {encryptSecret}=await import('./lib/llm/secret-store.js');
    console.log(JSON.stringify(encryptSecret('deepseek-secret-9876')));
  `);
  assert.equal(create.status,0,create.stderr);
  const record=JSON.parse(create.stdout.trim());
  const open=run(`
    process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key2)};
    process.env.APP_ENV='production';
    const {decryptSecret}=await import('./lib/llm/secret-store.js');
    try{
      decryptSecret(${JSON.stringify(record)});
      console.log('unexpected-success');
    }catch(error){
      console.log(error.code||error.message);
    }
  `);
  assert.equal(open.status,0,open.stderr);
  assert.match(open.stdout,/LLM_SECRET_DECRYPT_FAILED/);
});

test('production requires an explicit 32-byte base64 master key',()=>{
  const result=run(`
    delete process.env.LLM_SECRET_MASTER_KEY;
    process.env.APP_ENV='production';
    const {loadLlmMasterKey}=await import('./lib/llm/secret-store.js');
    try{
      loadLlmMasterKey();
      console.log('unexpected-success');
    }catch(error){
      console.log(error.code||error.message);
    }
  `,{LLM_SECRET_MASTER_KEY:''});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/LLM_MASTER_KEY_REQUIRED/);
});

test('development persists and reuses a generated local LLM master key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-llm-key-'));
  const keyPath=join(dir,'llm-secret.key');
  try{
    const script=`
      delete process.env.LLM_SECRET_MASTER_KEY;
      process.env.APP_ENV='development';
      process.env.DB_DRIVER='sqlite';
      process.env.LLM_SECRET_KEY_PATH=${JSON.stringify(keyPath)};
      const {loadLlmMasterKey}=await import('./lib/llm/secret-store.js');
      console.log(loadLlmMasterKey().toString('base64'));
    `;
    const first=run(script,{LLM_SECRET_MASTER_KEY:''});
    const second=run(script,{LLM_SECRET_MASTER_KEY:''});
    assert.equal(first.status,0,first.stderr);
    assert.equal(second.status,0,second.stderr);
    assert.equal(first.stdout.trim(),second.stdout.trim());
    assert.equal(Buffer.from(first.stdout.trim(),'base64').length,32);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
