import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { getCaseDefinition } from './server-cases.js';
import { resolveAgentRoutes,snapshotAgentRoutes } from './llm/routes.js';
import { isProductionEnv } from './request-security.js';

function providerError(code){
  const error=new Error(code);
  error.code=code;
  return error;
}

function mockRoute(agent){
  return {
    id:null,connectionId:null,providerKind:'mock',preset:'mock',
    model:'deterministic-mock',config:{},agentType:agent
  };
}

export async function createInterviewSession({user,caseId,mode='training',coachEnabled=false}) {
  const found=await getCaseDefinition(caseId);
  if(!found) throw new Error('CASE_NOT_FOUND');

  const resolved=await resolveAgentRoutes({caseId});
  if(isProductionEnv() && !resolved.patient) throw providerError('AI_PROVIDER_NOT_CONFIGURED');
  if(isProductionEnv() && coachEnabled && !resolved.coach) throw providerError('AI_COACH_PROVIDER_NOT_CONFIGURED');
  if(!isProductionEnv()){
    resolved.patient=resolved.patient||mockRoute('patient');
    resolved.coach=resolved.coach||mockRoute('coach');
    resolved.evaluator=resolved.evaluator||mockRoute('evaluator');
  }
  const routeSnapshot=snapshotAgentRoutes(resolved);

  await query(
    "update interview_sessions set status='abandoned',ended_at=now(),updated_at=now() where student_user_id=$1 and status='active'",
    [user.id]
  );
  const id=randomUUID();
  await query(
    `insert into interview_sessions
      (id,case_id,case_version,case_snapshot,student_user_id,mode,coach_enabled,coach_used,status,revealed_fact_ids,llm_route_snapshot)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,$7,'active','[]'::jsonb,$8::jsonb)`,
    [id,caseId,found.row.version,JSON.stringify(found.definition),user.id,mode,Boolean(coachEnabled),JSON.stringify(routeSnapshot)]
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
     where s.id=$1 and s.student_user_id=$2 limit 1`,
    [sessionId,user.id]
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
  const current=(await query(
    `select id,llm_route_snapshot from interview_sessions
     where id=$1 and status='active' and mode='training' and student_user_id=$2 limit 1`,
    [sessionId,user.id]
  ))[0];
  if(!current) return null;
  if(enabled){
    const snapshot=typeof current.llm_route_snapshot==='string'
      ?JSON.parse(current.llm_route_snapshot||'{}')
      :(current.llm_route_snapshot||{});
    if(!snapshot.coach) throw providerError('AI_COACH_PROVIDER_NOT_CONFIGURED');
  }
  const rows=await query(
    `update interview_sessions
     set coach_enabled=$3,coach_used=(coach_used or $3),updated_at=now()
     where id=$1 and status='active' and mode='training'
       and student_user_id=$2
     returning id,coach_enabled,coach_used`,
    [sessionId,user.id,Boolean(enabled)]
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
