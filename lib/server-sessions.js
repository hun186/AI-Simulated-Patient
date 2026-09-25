import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { getCaseDefinition } from './server-cases.js';

export async function createInterviewSession({user,caseId,mode='training',coachEnabled=false}) {
  const found=await getCaseDefinition(caseId);
  if(!found) throw new Error('CASE_NOT_FOUND');
  await query(
    "update interview_sessions set status='abandoned',ended_at=now(),updated_at=now() where student_user_id=$1 and status='active'",
    [user.id]
  );
  const id=randomUUID();
  await query(
    `insert into interview_sessions
      (id,case_id,case_version,student_user_id,mode,coach_enabled,status,revealed_fact_ids)
     values ($1,$2,$3,$4,$5,$6,'active','[]'::jsonb)`,
    [id,caseId,found.row.version,user.id,mode,Boolean(coachEnabled)]
  );
  await query(
    "insert into interview_messages (session_id,role,content) values ($1,'patient',$2)",
    [id,found.definition.opening]
  );
  return {id,caseId,mode,coachEnabled:Boolean(coachEnabled),opening:found.definition.opening};
}

export async function getOwnedSession(sessionId,user) {
  const rows=await query(
    `select s.* from interview_sessions s
     where s.id=$1 and (s.student_user_id=$2 or $3='teacher') limit 1`,
    [sessionId,user.id,user.role]
  );
  return rows[0]||null;
}

export async function getTranscript(sessionId) {
  return query(
    'select role,content,created_at as at from interview_messages where session_id=$1 order by id asc',
    [sessionId]
  );
}

export async function appendMessage(sessionId,role,content) {
  await query('insert into interview_messages (session_id,role,content) values ($1,$2,$3)',[sessionId,role,content]);
}

export async function setRevealedFacts(sessionId,ids) {
  await query('update interview_sessions set revealed_fact_ids=$2::jsonb,updated_at=now() where id=$1',[sessionId,JSON.stringify(ids)]);
}

export async function updateCoachEnabled(sessionId,user,enabled) {
  const rows=await query(
    `update interview_sessions
     set coach_enabled=$4,updated_at=now()
     where id=$1 and status='active' and mode='training'
       and (student_user_id=$2 or $3='teacher')
     returning id,coach_enabled`,
    [sessionId,user.id,user.role,Boolean(enabled)]
  );
  return rows[0]||null;
}

export async function completeSession(sessionId,evaluation) {
  await query(
    "update interview_sessions set status='completed',ended_at=now(),updated_at=now() where id=$1",
    [sessionId]
  );
  await query(
    `insert into evaluations (session_id,rubric_version,total_score,max_score,percentage,result_json)
     values ($1,1,$2,$3,$4,$5::jsonb)
     on conflict (session_id) do update set total_score=excluded.total_score,max_score=excluded.max_score,
       percentage=excluded.percentage,result_json=excluded.result_json,created_at=now()`,
    [sessionId,evaluation.totalScore,evaluation.maxScore,evaluation.percentage,JSON.stringify(evaluation)]
  );
}
