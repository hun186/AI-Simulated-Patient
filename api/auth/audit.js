import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { hasPermission,PERMISSIONS } from '../../lib/authz.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;
  const limit=Math.max(1,Math.min(200,Number(req.query?.limit||100)));
  let rows;
  if(hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL)){
    rows=await query(
      `select id,action,success,reason,actor_user_id as "actorUserId",target_user_id as "targetUserId",
       identifier,client_host as "clientHost",user_agent as "userAgent",metadata_json as metadata,created_at as "createdAt"
       from auth_audit_events order by created_at desc limit $1`,[limit]
    );
  }else{
    rows=await query(
      `select id,action,success,reason,actor_user_id as "actorUserId",target_user_id as "targetUserId",
       identifier,client_host as "clientHost",user_agent as "userAgent",metadata_json as metadata,created_at as "createdAt"
       from auth_audit_events
       where actor_user_id=$1 or target_user_id=$1
       order by created_at desc limit $2`,[user.id,limit]
    );
  }
  return res.status(200).json({events:rows,isRestrictedToSelf:!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL)});
}
