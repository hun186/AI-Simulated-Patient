import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { chmodSync,existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));

function codedError(code,message=code,cause){
  const error=new Error(message,{cause});
  error.code=code;
  return error;
}

function isProduction(){
  return String(process.env.APP_ENV||process.env.NODE_ENV||'').trim().toLowerCase()==='production';
}

export function llmLocalKeyPath(){
  const configured=String(process.env.LLM_SECRET_KEY_PATH||'').trim();
  if(configured) return isAbsolute(configured)?configured:resolve(projectRoot,configured);
  return resolve(projectRoot,'data','llm-secret.key');
}

function decodeMasterKey(value){
  const text=String(value||'').trim();
  if(!text) return null;
  let key;
  try{key=Buffer.from(text,'base64');}
  catch(error){throw codedError('LLM_MASTER_KEY_INVALID','LLM master key must be base64 encoded',error);}
  if(key.length!==32) throw codedError('LLM_MASTER_KEY_INVALID','LLM master key must decode to exactly 32 bytes');
  return key;
}

function readLocalKey(path){
  if(!existsSync(path)) return null;
  const key=decodeMasterKey(readFileSync(path,'utf8'));
  if(!key) throw codedError('LLM_MASTER_KEY_INVALID','Local LLM master key file is empty');
  return key;
}

function createLocalKey(path){
  mkdirSync(dirname(path),{recursive:true});
  const key=randomBytes(32);
  try{
    writeFileSync(path,key.toString('base64')+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
    try{chmodSync(path,0o600);}catch{}
    return key;
  }catch(error){
    if(error?.code==='EEXIST') return readLocalKey(path);
    throw error;
  }
}

export function loadLlmMasterKey(){
  const envKey=decodeMasterKey(process.env.LLM_SECRET_MASTER_KEY);
  if(envKey) return envKey;
  if(isProduction()) throw codedError('LLM_MASTER_KEY_REQUIRED','LLM_SECRET_MASTER_KEY is required in production');
  const path=llmLocalKeyPath();
  return readLocalKey(path)||createLocalKey(path);
}

export function encryptSecret(plaintext){
  const value=String(plaintext??'');
  if(!value) return {ciphertext:null,iv:null,tag:null,last4:''};
  const key=loadLlmMasterKey();
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return {
    ciphertext:encrypted.toString('base64'),
    iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),
    last4:value.slice(-4)
  };
}

export function decryptSecret(record){
  if(!record?.ciphertext) return '';
  try{
    const key=loadLlmMasterKey();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));
    decipher.setAuthTag(Buffer.from(record.tag,'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext,'base64')),
      decipher.final()
    ]).toString('utf8');
  }catch(error){
    throw codedError('LLM_SECRET_DECRYPT_FAILED','Unable to decrypt LLM provider credential',error);
  }
}
