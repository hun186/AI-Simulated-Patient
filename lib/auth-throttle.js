import { createHash } from 'node:crypto';
import { query } from './db.js';
import { clientHost } from './request-security.js';

const FAILURE_LIMIT=Math.max(3,Number(process.env.AUTH_THROTTLE_FAILURE_LIMIT||5));
const WINDOW_SECONDS=Math.max(60,Number(process.env.AUTH_THROTTLE_WINDOW_SECONDS||900));
const BLOCK_SECONDS=Math.max(60,Number(process.env.AUTH_THROTTLE_BLOCK_SECONDS||900));

function keyHash(scope,identifier,host){
  return createHash('sha256').update(`${scope}|${String(identifier).toLowerCase()}|${host}`).digest('hex');
}

export async function retryAfterSeconds(req,scope,identifier){
  const key=keyHash(scope,identifier,clientHost(req));
  const rows=await query('select blocked_until,window_started_at from auth_throttle where key_hash=$1 limit 1',[key]);
  const row=rows[0];
  if(!row) return 0;
  const blocked=row.blocked_until?new Date(row.blocked_until).getTime():0;
  const now=Date.now();
  if(blocked>now) return Math.max(1,Math.ceil((blocked-now)/1000));
  const started=new Date(row.window_started_at).getTime();
  if(!Number.isFinite(started) || now-started>WINDOW_SECONDS*1000){
    await query('delete from auth_throttle where key_hash=$1',[key]);
  }
  return 0;
}

export async function recordFailure(req,scope,identifier){
  const host=clientHost(req);
  const key=keyHash(scope,identifier,host);
  const rows=await query('select failures,window_started_at from auth_throttle where key_hash=$1 limit 1',[key]);
  const now=new Date();
  let failures=1;
  let windowStarted=now;
  if(rows[0]){
    const started=new Date(rows[0].window_started_at);
    if(now.getTime()-started.getTime()<=WINDOW_SECONDS*1000){
      failures=Number(rows[0].failures||0)+1;
      windowStarted=started;
    }
  }
  const blockedUntil=failures>=FAILURE_LIMIT?new Date(now.getTime()+BLOCK_SECONDS*1000):null;
  await query(
    `insert into auth_throttle (key_hash,scope,failures,window_started_at,blocked_until,updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (key_hash) do update set failures=excluded.failures,window_started_at=excluded.window_started_at,
       blocked_until=excluded.blocked_until,updated_at=now()`,
    [key,scope,failures,windowStarted.toISOString(),blockedUntil?.toISOString()||null]
  );
  return blockedUntil?BLOCK_SECONDS:0;
}

export async function clearFailures(req,scope,identifier){
  const key=keyHash(scope,identifier,clientHost(req));
  await query('delete from auth_throttle where key_hash=$1',[key]);
}
