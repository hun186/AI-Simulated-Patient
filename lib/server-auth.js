import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import {
  hashPassword,verifyPassword,newSessionToken,hashSessionToken,newCsrfToken,hashCsrfToken,
  DUMMY_PASSWORD_SALT,DUMMY_PASSWORD_HASH,validatePassword
} from './passwords.js';
import { isKnownRole,ROLE_STUDENT } from './authz.js';
import { requireTrustedOrigin,isProductionEnv } from './request-security.js';
import { retryAfterSeconds,recordFailure,clearFailures } from './auth-throttle.js';
import { recordAuthEvent } from './auth-audit.js';

const COOKIE='aisp_session';
const SESSION_TTL_SECONDS=Math.max(900,Number(process.env.AUTH_SESSION_TTL_SECONDS||43200));

function parseCookies(req){
  const raw=req.headers?.cookie||'';
  return Object.fromEntries(raw.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');
    return [decodeURIComponent(i>=0?v.slice(0,i):v),decodeURIComponent(i>=0?v.slice(i+1):'')];
  }));
}

function normalizeEmail(value){return String(value||'').trim().toLowerCase();}

export class AuthRateLimitError extends Error{
  constructor(retryAfter){super('AUTH_RATE_LIMITED');this.retryAfter=retryAfter;}
}

export function setSessionCookie(res,token,maxAge=SESSION_TTL_SECONDS){
  const secure=isProductionEnv()?'; Secure':'';
  res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function clearSessionCookie(res){
  const secure=isProductionEnv()?'; Secure':'';
  res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export async function countUsers(){
  const rows=await query('select count(*)::int as count from app_users');
  return rows[0]?.count||0;
}

export async function countAdmins(){
  const rows=await query("select count(*)::int as count from app_users where role='admin' and account_status='active'");
  return rows[0]?.count||0;
}

export async function createUser({email,password,displayName,role=ROLE_STUDENT,status='active'}){
  if(!isKnownRole(role)) throw new Error('INVALID_ROLE');
  validatePassword(password);
  if(!['active','pending','suspended'].includes(status)) throw new Error('INVALID_STATUS');
  const normalized=normalizeEmail(email);
  if(!normalized || !displayName?.trim()) throw new Error('INVALID_USER');
  const {salt,hash}=await hashPassword(password);
  const id=randomUUID();
  const rows=await query(
    `insert into app_users
     (id,email,display_name,role,password_salt,password_hash,is_active,account_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id,email,display_name,role,account_status,created_at`,
    [id,normalized,displayName.trim(),role,salt,hash,status==='active',status]
  );
  return rows[0];
}

export async function authenticateUser({email,password,req}){
  const normalized=normalizeEmail(email);
  const retry=await retryAfterSeconds(req,'login',normalized);
  if(retry){
    await recordAuthEvent({req,action:'auth.login',success:false,reason:'rate_limited',identifier:normalized});
    throw new AuthRateLimitError(retry);
  }

  const rows=await query('select * from app_users where lower(email)=lower($1) limit 1',[normalized]);
  const user=rows[0];
  const ok=user
    ? await verifyPassword(password,user.password_salt,user.password_hash)
    : await verifyPassword(password,DUMMY_PASSWORD_SALT,DUMMY_PASSWORD_HASH);

  if(!user || !ok || user.account_status!=='active' || !user.is_active){
    const blocked=await recordFailure(req,'login',normalized);
    await recordAuthEvent({
      req,action:'auth.login',success:false,
      reason:blocked?'rate_limited':'invalid_credentials_or_inactive',
      targetUserId:user?.id||null,identifier:normalized
    });
    if(blocked) throw new AuthRateLimitError(blocked);
    return null;
  }

  await clearFailures(req,'login',normalized);
  return user;
}

export async function createAuthSession(user,req){
  const token=newSessionToken();
  const csrfToken=newCsrfToken();
  const expiresAt=new Date(Date.now()+SESSION_TTL_SECONDS*1000).toISOString();
  await query(
    'insert into auth_sessions (token_hash,user_id,csrf_hash,expires_at) values ($1,$2,$3,$4)',
    [hashSessionToken(token),user.id,hashCsrfToken(csrfToken),expiresAt]
  );
  await recordAuthEvent({req,action:'auth.login',success:true,reason:'login_success',actorUserId:user.id,targetUserId:user.id,identifier:user.email});
  return {token,csrfToken,maxAge:SESSION_TTL_SECONDS,user:publicUser(user)};
}

export async function loginUser({email,password,req}){
  const user=await authenticateUser({email,password,req});
  return user?createAuthSession(user,req):null;
}

export function publicUser(user){
  return {
    id:user.id,email:user.email,displayName:user.display_name||user.displayName,
    role:user.role,accountStatus:user.account_status||user.accountStatus||'active'
  };
}

async function requestSession(req){
  const token=parseCookies(req)[COOKIE];
  if(!token) return null;
  const tokenHash=hashSessionToken(token);
  const rows=await query(
    `select s.token_hash,s.csrf_hash,s.user_id,s.expires_at,
       u.id,u.email,u.display_name,u.role,u.account_status,u.is_active
     from auth_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() limit 1`,
    [tokenHash]
  );
  const row=rows[0];
  if(!row || row.account_status!=='active' || !row.is_active) return null;
  return {tokenHash,row,user:publicUser(row)};
}

export async function getRequestUser(req){
  return (await requestSession(req))?.user||null;
}

export async function rotateCsrfToken(req){
  const session=await requestSession(req);
  if(!session) return null;
  const csrfToken=newCsrfToken();
  await query('update auth_sessions set csrf_hash=$2 where token_hash=$1',[session.tokenHash,hashCsrfToken(csrfToken)]);
  return csrfToken;
}

export async function requireCsrf(req,res){
  if(!requireTrustedOrigin(req,res)) return false;
  const session=await requestSession(req);
  if(!session){res.status(401).json({error:'Authentication required'});return false;}
  const supplied=String(req.headers?.['x-csrf-token']||'');
  if(!supplied || hashCsrfToken(supplied)!==session.row.csrf_hash){
    res.status(403).json({error:'Invalid CSRF token'});return false;
  }
  return true;
}

export async function logoutRequest(req){
  const session=await requestSession(req);
  if(!session) return;
  await query('delete from auth_sessions where token_hash=$1',[session.tokenHash]);
  await recordAuthEvent({req,action:'auth.logout',success:true,actorUserId:session.user.id,targetUserId:session.user.id,identifier:session.user.email});
}

export async function invalidateUserSessions(userId){
  await query('delete from auth_sessions where user_id=$1',[userId]);
}

export async function changePassword({user,currentPassword,newPassword,req}){
  validatePassword(newPassword);
  const rows=await query('select * from app_users where id=$1 limit 1',[user.id]);
  const stored=rows[0];
  if(!stored || !(await verifyPassword(currentPassword,stored.password_salt,stored.password_hash))){
    await recordAuthEvent({req,action:'auth.change_password',success:false,reason:'invalid_current_password',actorUserId:user.id,targetUserId:user.id,identifier:user.email});
    return false;
  }
  const {salt,hash}=await hashPassword(newPassword);
  await query('update app_users set password_salt=$2,password_hash=$3,updated_at=now() where id=$1',[user.id,salt,hash]);
  await invalidateUserSessions(user.id);
  await recordAuthEvent({req,action:'auth.change_password',success:true,reason:'password_changed',actorUserId:user.id,targetUserId:user.id,identifier:user.email});
  return true;
}

export async function resetPasswordByStaff({actor,targetUserId,newPassword,req}){
  validatePassword(newPassword);
  const {salt,hash}=await hashPassword(newPassword);
  await query('update app_users set password_salt=$2,password_hash=$3,updated_at=now() where id=$1',[targetUserId,salt,hash]);
  await invalidateUserSessions(targetUserId);
  await recordAuthEvent({req,action:'auth.admin_reset_password',success:true,reason:'staff_reset',actorUserId:actor.id,targetUserId});
}

export async function requireUser(req,res,roles=null){
  const user=await getRequestUser(req);
  if(!user){res.status(401).json({error:'Authentication required'});return null;}
  if(roles && !roles.includes(user.role)){res.status(403).json({error:'Forbidden'});return null;}
  return user;
}
