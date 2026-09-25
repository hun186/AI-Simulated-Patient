import { query } from './db.js';
import { clientHost,userAgent } from './request-security.js';

export async function recordAuthEvent({
  req,action,success=true,reason='',actorUserId=null,targetUserId=null,identifier='',metadata={}
}){
  try{
    await query(
      `insert into auth_audit_events
       (action,success,reason,actor_user_id,target_user_id,identifier,client_host,user_agent,metadata_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [action,Boolean(success),reason,actorUserId,targetUserId,String(identifier||'').slice(0,320),
       clientHost(req),userAgent(req),JSON.stringify(metadata||{})]
    );
  }catch(error){
    console.warn('auth_audit_write_failed',error?.message||error);
  }
}
