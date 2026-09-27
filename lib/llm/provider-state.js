import { query } from '../db.js';

function parseState(value){
  if(value==null) return {};
  if(typeof value==='string'){
    try{return JSON.parse(value)||{};}catch{return {};}
  }
  return value&&typeof value==='object'?value:{};
}

export async function getProviderSessionState({sessionId,connectionId}){
  if(!sessionId||!connectionId) return {};
  const rows=await query(
    `select state_json from llm_provider_session_state
     where session_id=$1 and connection_id=$2 limit 1`,
    [sessionId,connectionId]
  );
  return parseState(rows[0]?.state_json);
}

export async function setProviderSessionState({sessionId,connectionId,providerKind,state}){
  if(!sessionId||!connectionId) throw new Error('PROVIDER_SESSION_STATE_KEY_REQUIRED');
  const value=state&&typeof state==='object'&&!Array.isArray(state)?state:{};
  await query(
    `insert into llm_provider_session_state
      (session_id,connection_id,provider_kind,state_json)
     values ($1,$2,$3,$4::jsonb)
     on conflict (session_id,connection_id) do update set
       provider_kind=excluded.provider_kind,
       state_json=excluded.state_json,
       updated_at=now()`,
    [sessionId,connectionId,String(providerKind||'unknown'),JSON.stringify(value)]
  );
  return value;
}

export async function deleteProviderSessionState({sessionId,connectionId}){
  if(!sessionId||!connectionId) return;
  await query(
    'delete from llm_provider_session_state where session_id=$1 and connection_id=$2',
    [sessionId,connectionId]
  );
}
