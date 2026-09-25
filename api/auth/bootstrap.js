import { isDatabaseEnabled,query } from '../../lib/db.js';
import {
  countUsers,countAdmins,createUser,authenticateUser,createAuthSession,setSessionCookie,publicUser
} from '../../lib/server-auth.js';
import { requireTrustedOrigin,isProductionEnv } from '../../lib/request-security.js';
import { recordAuthEvent } from '../../lib/auth-audit.js';

function setupKeyIsSafe(){
  const key=String(process.env.ADMIN_SETUP_KEY||'');
  return !isProductionEnv() || Buffer.byteLength(key,'utf8')>=32;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  if(!requireTrustedOrigin(req,res)) return;
  if(!setupKeyIsSafe()) return res.status(503).json({error:'Production ADMIN_SETUP_KEY must be at least 32 bytes'});

  const {setupKey,email,password,displayName='Administrator',promoteExisting=false}=req.body??{};
  if(!process.env.ADMIN_SETUP_KEY || setupKey!==process.env.ADMIN_SETUP_KEY) return res.status(403).json({error:'Invalid setup key'});
  if(await countAdmins()) return res.status(409).json({error:'Administrator bootstrap already completed'});

  const total=await countUsers();
  let user;
  if(total===0){
    user=await createUser({email,password,displayName,role:'admin',status:'active'});
    await recordAuthEvent({req,action:'auth.bootstrap',success:true,reason:'first_admin_created',actorUserId:user.id,targetUserId:user.id,identifier:user.email});
  }else{
    if(!promoteExisting) return res.status(409).json({error:'Existing users require explicit administrator migration'});
    const stored=await authenticateUser({email,password,req});
    if(!stored) return res.status(401).json({error:'帳號或密碼錯誤，或帳號尚未啟用。'});
    await query("update app_users set role='admin',updated_at=now() where id=$1",[stored.id]);
    stored.role='admin';
    user=publicUser(stored);
    await recordAuthEvent({req,action:'auth.bootstrap',success:true,reason:'existing_user_promoted_to_admin',actorUserId:user.id,targetUserId:user.id,identifier:user.email});
  }

  const dbUser=total===0
    ? (await query('select * from app_users where id=$1',[user.id]))[0]
    : (await query('select * from app_users where id=$1',[user.id]))[0];
  const auth=await createAuthSession(dbUser,req);
  setSessionCookie(res,auth.token,auth.maxAge);
  return res.status(201).json({user:auth.user,csrfToken:auth.csrfToken});
}
