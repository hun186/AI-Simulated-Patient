import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { query } from '../../lib/db.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const teacher=await requireUser(req,res,['teacher']);
  if(!teacher) return;
  const rows=await query(
    `select s.id,s.mode,s.coach_enabled as "coachEnabled",s.coach_used as "coachUsed",s.started_at as "startedAt",s.ended_at as "endedAt",
       u.display_name as "studentName",c.student_label as "caseTitle",
       e.percentage,e.total_score as "totalScore",e.max_score as "maxScore",e.result_json as evaluation,
       coalesce((
         select json_agg(json_build_object('role',m.role,'content',m.content,'at',m.created_at) order by m.id)
         from interview_messages m where m.session_id=s.id
       ),'[]'::json) as transcript
     from interview_sessions s
     join app_users u on u.id=s.student_user_id
     join cases c on c.id=s.case_id
     left join evaluations e on e.session_id=s.id
     where s.status='completed'
     order by s.started_at desc limit 500`
  );
  return res.status(200).json({records:rows});
}
