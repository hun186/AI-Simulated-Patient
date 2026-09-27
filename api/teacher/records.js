import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';
import { getLatestEvaluationAuditSummaries } from '../../lib/evaluation-audit-store.js';

const SELECT_BASE=`select s.id,s.mode,s.coach_enabled as "coachEnabled",s.coach_used as "coachUsed",
 s.started_at as "startedAt",s.ended_at as "endedAt",u.id as "studentUserId",
 u.display_name as "studentName",c.student_label as "caseTitle",
 s.teacher_snapshot as "teacherSnapshot",s.llm_route_snapshot as "llmRouteSnapshot",
 e.percentage,e.total_score as "totalScore",e.max_score as "maxScore",e.result_json as evaluation
 from interview_sessions s
 join app_users u on u.id=s.student_user_id
 join cases c on c.id=s.case_id
 left join evaluations e on e.session_id=s.id`;

function parseJson(value,fallback){
  if(value==null) return fallback;
  if(typeof value!=='string') return value;
  try{return JSON.parse(value);}catch{return fallback;}
}

function groupPush(map,key,value){
  if(!map.has(key)) map.set(key,[]);
  map.get(key).push(value);
}

function placeholders(values){
  return values.map((_,index)=>String.fromCharCode(36)+(index+1)).join(',');
}

async function attachDetails(rows){
  if(!rows.length) return rows;
  const ids=rows.map(row=>row.id);
  const sessionPlaceholders=placeholders(ids);
  const studentIds=[...new Set(rows.map(row=>row.studentUserId).filter(Boolean))];
  const studentPlaceholders=placeholders(studentIds);

  const [messages,coachEvents,usageEvents,currentTeachers,auditBySession]=await Promise.all([
    query(
      `select session_id as "sessionId",role,content,created_at as at
       from interview_messages where session_id in (${sessionPlaceholders})
       order by session_id,id`,
      ids
    ),
    query(
      `select session_id as "sessionId",payload_json as payload,created_at as at
       from interview_coach_events where session_id in (${sessionPlaceholders})
       order by session_id,id`,
      ids
    ),
    query(
      `select session_id as "sessionId",agent_type as "agentType",
         provider_kind as "providerKind",preset,model,
         input_tokens as "inputTokens",cached_input_tokens as "cachedInputTokens",
         output_tokens as "outputTokens",reasoning_tokens as "reasoningTokens",
         total_tokens as "totalTokens",success,error_code as "errorCode",
         estimated_cost_microusd as "estimatedCostMicrousd",
         estimated_cost_microntd as "estimatedCostMicrontd",
         pricing_status as "pricingStatus",created_at as at
       from llm_usage_events where session_id in (${sessionPlaceholders})
       order by session_id,id`,
      ids
    ),
    studentIds.length
      ?query(
        `select a.student_user_id as "studentUserId",u.id,u.display_name as "displayName"
         from teacher_student_assignments a
         join app_users u on u.id=a.teacher_user_id
         where a.student_user_id in (${studentPlaceholders})
           and u.role='teacher' and u.is_active=true
         order by a.student_user_id,u.display_name,u.id`,
        studentIds
      )
      :Promise.resolve([]),
    getLatestEvaluationAuditSummaries(ids)
  ]);

  const transcriptBySession=new Map();
  for(const message of messages){
    groupPush(transcriptBySession,message.sessionId,{
      role:message.role,content:message.content,at:message.at
    });
  }

  const coachBySession=new Map();
  for(const event of coachEvents){
    groupPush(coachBySession,event.sessionId,{
      ...parseJson(event.payload,{}),at:event.at
    });
  }

  const usageBySession=new Map();
  for(const event of usageEvents){
    groupPush(usageBySession,event.sessionId,{
      ...event,
      success:Boolean(event.success)
    });
  }

  const teachersByStudent=new Map();
  for(const teacher of currentTeachers){
    groupPush(teachersByStudent,teacher.studentUserId,{
      id:teacher.id,displayName:teacher.displayName
    });
  }

  return rows.map(row=>{
    const snapshot=parseJson(row.teacherSnapshot,[]);
    const hasSnapshot=Array.isArray(snapshot)&&snapshot.length>0;
    const current=teachersByStudent.get(row.studentUserId)||[];
    return {
      ...row,
      coachEnabled:Boolean(row.coachEnabled),
      coachUsed:Boolean(row.coachUsed),
      evaluation:parseJson(row.evaluation,null),
      transcript:transcriptBySession.get(row.id)||[],
      coachEvents:coachBySession.get(row.id)||[],
      llmRoutes:parseJson(row.llmRouteSnapshot,{}),
      llmUsage:usageBySession.get(row.id)||[],
      teachers:hasSnapshot?snapshot:current,
      teacherSource:hasSnapshot?'session_snapshot':(current.length?'current_assignment':'none'),
      evaluationAudit:auditBySession.get(row.id)||null
    };
  });
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor) return;

  const rows=actor.role===ROLE_ADMIN
    ? await query(`${SELECT_BASE} where s.status='completed' order by s.started_at desc limit 500`)
    : await query(
        `${SELECT_BASE}
         where s.status='completed' and (
           s.student_user_id=$1 or exists (
             select 1 from teacher_student_assignments a
             where a.teacher_user_id=$1 and a.student_user_id=s.student_user_id
           )
         )
         order by s.started_at desc limit 500`,
        [actor.id]
      );
  return res.status(200).json({records:await attachDetails(rows),scope:actor.role===ROLE_ADMIN?'all':'assigned'});
}
