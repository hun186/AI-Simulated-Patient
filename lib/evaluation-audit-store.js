import { query } from './db.js';
import { evaluationAuditSummary } from './evaluation-audit.js';

function parseJson(value,fallback=null){
  if(value==null)return fallback;
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return fallback;}
}

function placeholders(values,start=1){
  return values.map((_,index)=>'$'+(start+index)).join(',');
}

export async function pruneExpiredEvaluationAudits(now=new Date()){
  await query('delete from evaluation_audits where expires_at<$1',[now.toISOString()]);
}

export async function saveEvaluationAudit({audit,sessionId,studentUserId}){
  await pruneExpiredEvaluationAudits();
  await query(
    `insert into evaluation_audits
      (evaluation_id,session_id,student_user_id,status,audit_json,expires_at)
     values ($1,$2,$3,$4,$5::jsonb,$6)
     on conflict (evaluation_id) do update set
       status=excluded.status,audit_json=excluded.audit_json,expires_at=excluded.expires_at`,
    [audit.evaluationId,sessionId,studentUserId,audit.status,JSON.stringify(audit),audit.expiresAt]
  );
}

export async function getEvaluationAuditForActor(evaluationId,actor){
  if(!evaluationId||!actor||!['admin','teacher'].includes(actor.role))return null;
  const now=new Date().toISOString();
  const rows=actor.role==='admin'
    ?await query(
      `select a.evaluation_id as "evaluationId",a.session_id as "sessionId",
        a.student_user_id as "studentUserId",a.status,a.audit_json as audit,
        a.created_at as "createdAt",a.expires_at as "expiresAt"
       from evaluation_audits a
       where a.evaluation_id=$1 and a.expires_at>=$2 limit 1`,
      [evaluationId,now]
    )
    :await query(
      `select a.evaluation_id as "evaluationId",a.session_id as "sessionId",
        a.student_user_id as "studentUserId",a.status,a.audit_json as audit,
        a.created_at as "createdAt",a.expires_at as "expiresAt"
       from evaluation_audits a
       where a.evaluation_id=$1 and a.expires_at>=$3 and (
         a.student_user_id=$2 or exists (
           select 1 from teacher_student_assignments tsa
           where tsa.teacher_user_id=$2 and tsa.student_user_id=a.student_user_id
         )
       ) limit 1`,
      [evaluationId,actor.id,now]
    );
  const row=rows[0];
  if(!row)return null;
  return {...row,audit:parseJson(row.audit,{})};
}

export async function getEvaluationAuditSummariesForSessions(sessionIds=[]){
  const ids=[...new Set(sessionIds.filter(Boolean))];
  if(!ids.length)return new Map();
  const now=new Date().toISOString();
  const expiryPlaceholder='$'+(ids.length+1);
  const rows=await query(
    `select evaluation_id as "evaluationId",session_id as "sessionId",
      status,audit_json as audit,created_at as "createdAt",expires_at as "expiresAt"
     from evaluation_audits
     where session_id in (${placeholders(ids)}) and expires_at>=${expiryPlaceholder}
     order by session_id,created_at desc`,
    [...ids,now]
  );
  const map=new Map();
  for(const row of rows){
    if(!map.has(row.sessionId))map.set(row.sessionId,[]);
    const audit=parseJson(row.audit,{});
    map.get(row.sessionId).push({
      ...evaluationAuditSummary(audit),
      evaluationId:row.evaluationId,
      status:row.status,
      createdAt:row.createdAt,
      expiresAt:row.expiresAt
    });
  }
  return map;
}

export async function getLatestEvaluationAuditSummaries(sessionIds=[]){
  const all=await getEvaluationAuditSummariesForSessions(sessionIds);
  return new Map([...all].map(([sessionId,items])=>[sessionId,items[0]||null]));
}
