import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { decryptSecret,encryptSecret } from './secret-store.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../authz.js';

const PRESETS={
  openai:{providerKind:'openai',baseUrl:'https://api.openai.com/v1',teacherAllowed:true,keyRequired:true},
  deepseek:{providerKind:'openai_compatible',baseUrl:'https://api.deepseek.com',teacherAllowed:true,keyRequired:true},
  ollama:{providerKind:'openai_compatible',baseUrl:'http://127.0.0.1:11434/v1',teacherAllowed:false,keyRequired:false},
  custom:{providerKind:'openai_compatible',baseUrl:null,teacherAllowed:false,keyRequired:false}
};

function fail(code,message=code){
  const error=new Error(message);
  error.code=code;
  return error;
}

function cleanText(value,max=200){
  return String(value??'').trim().slice(0,max);
}

function normalizeBaseUrl(value){
  const text=cleanText(value,2000).replace(/\/+$/,'');
  if(!text) return '';
  let url;
  try{url=new URL(text);}
  catch{throw fail('INVALID_BASE_URL');}
  if(!['http:','https:'].includes(url.protocol)) throw fail('INVALID_BASE_URL');
  url.hash='';
  url.search='';
  return url.toString().replace(/\/+$/,'');
}

function presetRules(preset){
  const rules=PRESETS[preset];
  if(!rules) throw fail('INVALID_PRESET');
  return rules;
}

function canManage(actor,row){
  if(actor?.role===ROLE_ADMIN) return true;
  return actor?.role===ROLE_TEACHER
    && row?.scope_type==='teacher'
    && row?.owner_user_id===actor.id;
}

function dto(row,{actor=null}={}){
  const own=actor?.role===ROLE_ADMIN || row.owner_user_id===actor?.id;
  return {
    id:row.id,
    scopeType:row.scope_type,
    ownerUserId:row.owner_user_id||null,
    name:row.name,
    providerKind:row.provider_kind,
    preset:row.preset,
    baseUrl:own?row.base_url:null,
    defaultModel:row.default_model,
    apiKeyLast4:row.api_key_last4||'',
    isActive:Boolean(row.is_active),
    createdBy:row.created_by||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function byId(id){
  const rows=await query('select * from llm_provider_connections where id=$1 limit 1',[id]);
  return rows[0]||null;
}

function validatedInput(actor,input,existing=null){
  if(!actor || ![ROLE_ADMIN,ROLE_TEACHER].includes(actor.role)) throw fail('FORBIDDEN');
  const preset=cleanText(input.preset??existing?.preset,32);
  const rules=presetRules(preset);
  if(actor.role===ROLE_TEACHER && !rules.teacherAllowed) throw fail('FORBIDDEN_PRESET');
  const name=cleanText(input.name??existing?.name,120);
  const defaultModel=cleanText(input.defaultModel??existing?.default_model,240);
  if(!name) throw fail('NAME_REQUIRED');
  if(!defaultModel) throw fail('MODEL_REQUIRED');

  let baseUrl=rules.baseUrl||'';
  if(preset==='ollama'){
    baseUrl=actor.role===ROLE_ADMIN
      ? normalizeBaseUrl(input.baseUrl??existing?.base_url??rules.baseUrl)
      : rules.baseUrl;
  }else if(preset==='custom'){
    if(actor.role!==ROLE_ADMIN) throw fail('FORBIDDEN_PRESET');
    baseUrl=normalizeBaseUrl(input.baseUrl??existing?.base_url);
    if(!baseUrl) throw fail('BASE_URL_REQUIRED');
  }

  const apiKeySupplied=Object.prototype.hasOwnProperty.call(input,'apiKey');
  const apiKey=apiKeySupplied?String(input.apiKey??''):null;
  if(!existing && rules.keyRequired && !apiKey) throw fail('API_KEY_REQUIRED');
  if(apiKeySupplied && rules.keyRequired && !apiKey) throw fail('API_KEY_REQUIRED');

  return {
    preset,
    providerKind:rules.providerKind,
    name,
    baseUrl,
    defaultModel,
    apiKeySupplied,
    apiKey,
    isActive:input.isActive===undefined?(existing?Boolean(existing.is_active):true):Boolean(input.isActive)
  };
}

export async function listVisibleConnections(actor){
  let rows;
  if(actor.role===ROLE_ADMIN){
    rows=await query('select * from llm_provider_connections order by updated_at desc');
  }else if(actor.role===ROLE_TEACHER){
    rows=await query(
      `select * from llm_provider_connections
       where (scope_type='teacher' and owner_user_id=$1)
          or (scope_type='system' and is_active=true)
       order by updated_at desc`,
      [actor.id]
    );
  }else{
    throw fail('FORBIDDEN');
  }
  return rows.map(row=>dto(row,{actor}));
}

export async function createConnection(actor,input){
  const value=validatedInput(actor,input);
  const scopeType=actor.role===ROLE_ADMIN?'system':'teacher';
  const ownerUserId=scopeType==='teacher'?actor.id:null;
  const encrypted=value.apiKey?encryptSecret(value.apiKey):{ciphertext:null,iv:null,tag:null,last4:''};
  const id=randomUUID();
  await query(
    `insert into llm_provider_connections
      (id,scope_type,owner_user_id,name,provider_kind,preset,base_url,default_model,
       encrypted_api_key,api_key_iv,api_key_tag,api_key_last4,is_active,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,scopeType,ownerUserId,value.name,value.providerKind,value.preset,value.baseUrl,value.defaultModel,
      encrypted.ciphertext,encrypted.iv,encrypted.tag,encrypted.last4,value.isActive,actor.id
    ]
  );
  return dto(await byId(id),{actor});
}

export async function updateConnection(actor,id,input){
  const existing=await byId(id);
  if(!existing) throw fail('CONNECTION_NOT_FOUND');
  if(!canManage(actor,existing)) throw fail('FORBIDDEN');
  const value=validatedInput(actor,input,existing);
  let encrypted={
    ciphertext:existing.encrypted_api_key,
    iv:existing.api_key_iv,
    tag:existing.api_key_tag,
    last4:existing.api_key_last4||''
  };
  if(value.apiKeySupplied){
    encrypted=value.apiKey?encryptSecret(value.apiKey):{ciphertext:null,iv:null,tag:null,last4:''};
  }
  await query(
    `update llm_provider_connections set
       name=$2,provider_kind=$3,preset=$4,base_url=$5,default_model=$6,
       encrypted_api_key=$7,api_key_iv=$8,api_key_tag=$9,api_key_last4=$10,
       is_active=$11,updated_at=now()
     where id=$1`,
    [
      id,value.name,value.providerKind,value.preset,value.baseUrl,value.defaultModel,
      encrypted.ciphertext,encrypted.iv,encrypted.tag,encrypted.last4,value.isActive
    ]
  );
  return dto(await byId(id),{actor});
}

export async function deleteConnection(actor,id){
  const existing=await byId(id);
  if(!existing) throw fail('CONNECTION_NOT_FOUND');
  if(!canManage(actor,existing)) throw fail('FORBIDDEN');
  await query('delete from llm_provider_connections where id=$1',[id]);
}

export async function getConnectionForUse(id){
  const row=await byId(id);
  if(!row || !row.is_active) throw fail('CONNECTION_NOT_AVAILABLE');
  return {
    id:row.id,
    scopeType:row.scope_type,
    ownerUserId:row.owner_user_id||null,
    name:row.name,
    providerKind:row.provider_kind,
    preset:row.preset,
    baseUrl:row.base_url,
    defaultModel:row.default_model,
    apiKey:decryptSecret({
      ciphertext:row.encrypted_api_key,
      iv:row.api_key_iv,
      tag:row.api_key_tag
    }),
    isActive:Boolean(row.is_active)
  };
}

export async function getManagedConnectionForUse(actor,id){
  const row=await byId(id);
  if(!row) throw fail('CONNECTION_NOT_FOUND');
  if(!canManage(actor,row)) throw fail('FORBIDDEN');
  if(!row.is_active) throw fail('CONNECTION_NOT_AVAILABLE');
  return getConnectionForUse(id);
}
