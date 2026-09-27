import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { normalizeStudentReportExportPolicy,canStudentExportReport } from '../../lib/report-policy.js';

function parseJson(value,fallback){
  if(value==null) return fallback;
  if(typeof value!=='string') return value;
  try{return JSON.parse(value);}catch{return fallback;}
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res,['student','teacher','admin']);
  if(!user) return;

  const sessionId=String(req.query?.sessionId||'').trim();
  if(!sessionId) return res.status(400).json({error:'sessionId is required'});

  const rows=await query(
    `select s.id,s.case_id as "caseId",s.mode,
       s.coach_enabled as "coachEnabled",s.coach_used as "coachUsed",
       s.started_at as "startedAt",s.ended_at as "endedAt",
       s.student_user_id as "studentUserId",
       s.teacher_snapshot as "teacherSnapshot",
       s.llm_route_snapshot as "llmRouteSnapshot",
       u.display_name as "studentName",
       c.student_label as "caseTitle",c.definition_json as "caseDefinition",
       e.percentage,e.total_score as "totalScore",e.max_score as "maxScore",
       e.result_json as evaluation
     from interview_sessions s
     join app_users u on u.id=s.student_user_id
     join cases c on c.id=s.case_id
     left join evaluations e on e.session_id=s.id
     where s.id=$1 and s.student_user_id=$2 and s.status='completed'
     limit 1`,
    [sessionId,user.id]
  );
  const row=rows[0];
  if(!row) return res.status(404).json({error:'Completed session not found'});

  const caseDefinition=parseJson(row.caseDefinition,{});
  const policy=normalizeStudentReportExportPolicy(caseDefinition.studentReportExportPolicy);
  if(user.role==='student'&&!canStudentExportReport(policy,row.mode)){
    return res.status(403).json({
      error:'STUDENT_REPORT_EXPORT_NOT_ALLOWED',
      studentReportExportPolicy:policy,
      mode:row.mode
    });
  }

  const [messages,coachEvents,usageEvents,currentTeachers]=await Promise.all([
    query(
      `select role,content,created_at as at
       from interview_messages where session_id=$1 order by id`,
      [sessionId]
    ),
    query(
      `select payload_json as payload,created_at as at
       from interview_coach_events where session_id=$1 order by id`,
      [sessionId]
    ),
    query(
      `select agent_type as "agentType",provider_kind as "providerKind",
         preset,model,input_tokens as "inputTokens",
         cached_input_tokens as "cachedInputTokens",
         output_tokens as "outputTokens",reasoning_tokens as "reasoningTokens",
         total_tokens as "totalTokens",success,error_code as "errorCode",
         estimated_cost_microusd as "estimatedCostMicrousd",
         estimated_cost_microntd as "estimatedCostMicrontd",
         pricing_status as "pricingStatus",created_at as at
       from llm_usage_events where session_id=$1 order by id`,
      [sessionId]
    ),
    query(
      `select u.id,u.display_name as "displayName"
       from teacher_student_assignments a
       join app_users u on u.id=a.teacher_user_id
       where a.student_user_id=$1 and u.role='teacher' and u.is_active=true
       order by u.display_name,u.id`,
      [user.id]
    )
  ]);

  const snapshot=parseJson(row.teacherSnapshot,[]);
  const hasSnapshot=Array.isArray(snapshot)&&snapshot.length>0;
  const record={
    id:row.id,
    caseTitle:row.caseTitle,
    studentUserId:row.studentUserId,
    studentName:row.studentName,
    teachers:hasSnapshot?snapshot:currentTeachers.map(item=>({id:item.id,displayName:item.displayName})),
    teacherSource:hasSnapshot?'session_snapshot':(currentTeachers.length?'current_assignment':'none'),
    mode:row.mode,
    coachEnabled:Boolean(row.coachEnabled),
    coachUsed:Boolean(row.coachUsed),
    startedAt:row.startedAt,
    endedAt:row.endedAt,
    percentage:Number(row.percentage||0),
    totalScore:Number(row.totalScore||0),
    maxScore:Number(row.maxScore||0),
    transcript:messages,
    coachEvents:coachEvents.map(event=>({...parseJson(event.payload,{}),at:event.at})),
    llmRoutes:parseJson(row.llmRouteSnapshot,{}),
    llmUsage:usageEvents.map(event=>({...event,success:Boolean(event.success)})),
    evaluation:parseJson(row.evaluation,null),
    studentReportExportPolicy:policy
  };
  return res.status(200).json({record});
}
