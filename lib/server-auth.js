import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { hashPassword, verifyPassword, newSessionToken, hashSessionToken } from './passwords.js';

const COOKIE='aisp_session';

function parseCookies(req) {
  const raw=req.headers?.cookie || '';
  return Object.fromEntries(raw.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('=');
    return [decodeURIComponent(i>=0?v.slice(0,i):v), decodeURIComponent(i>=0?v.slice(i+1):'')];
  }));
}

export function setSessionCookie(res, token, maxAge=60*60*24*7) {
  const secure=process.env.NODE_ENV==='production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function countUsers() {
  const rows=await query('select count(*)::int as count from app_users');
  return rows[0]?.count || 0;
}

export async function createUser({email,password,displayName,role='student'}) {
  const {salt,hash}=await hashPassword(password);
  const id=randomUUID();
  const rows=await query(
    'insert into app_users (id,email,display_name,role,password_salt,password_hash) values ($1,$2,$3,$4,$5,$6) returning id,email,display_name,role,created_at',
    [id,email.toLowerCase().trim(),displayName.trim(),role,salt,hash]
  );
  return rows[0];
}

export async function loginUser({email,password}) {
  const rows=await query('select * from app_users where lower(email)=lower($1) and is_active=true limit 1',[email]);
  const user=rows[0];
  if(!user || !(await verifyPassword(password,user.password_salt,user.password_hash))) return null;
  const token=newSessionToken();
  const tokenHash=hashSessionToken(token);
  await query(
    "insert into auth_sessions (token_hash,user_id,expires_at) values ($1,$2,now()+interval '7 days')",
    [tokenHash,user.id]
  );
  return {token,user:{id:user.id,email:user.email,displayName:user.display_name,role:user.role}};
}

export async function logoutRequest(req) {
  const token=parseCookies(req)[COOKIE];
  if(token) await query('delete from auth_sessions where token_hash=$1',[hashSessionToken(token)]);
}

export async function getRequestUser(req) {
  const token=parseCookies(req)[COOKIE];
  if(!token) return null;
  const rows=await query(
    `select u.id,u.email,u.display_name,u.role
     from auth_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() and u.is_active=true
     limit 1`,
    [hashSessionToken(token)]
  );
  const u=rows[0];
  return u?{id:u.id,email:u.email,displayName:u.display_name,role:u.role}:null;
}

export async function requireUser(req,res,roles=null) {
  const user=await getRequestUser(req);
  if(!user){res.status(401).json({error:'Authentication required'});return null;}
  if(roles && !roles.includes(user.role)){res.status(403).json({error:'Forbidden'});return null;}
  return user;
}
