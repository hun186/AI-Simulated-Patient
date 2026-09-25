import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';

const SELECT_BASE=`select s.id,s.mode,s.coach_enabled as "coachEnabled",s.coach_used as "coachUsed",
 s.started_at as "startedAt",s.ended_at as "endedAt",u.id as "studentUserId",
 u.display_name as "studentName",c.student_label as "caseTitle",
 e.percentage,e.total_score as "totalScore",e.max_score as "maxScore",e.result_json as evaluation,
 coalesce((
   select json_agg(json_build_object('role',m.role,'content',m.content,'at',m.created_at) order by m.id)
   from interview_messages m where m.session_id=s.id
 ),'[]'::json) as transcript
 from interview_sessions s
 join app_users u on u.id=s.student_user_id
 join cases c on c.id=s.case_id
 left join evaluations e on e.session_id=s.id`;

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
  return res.status(200).json({records:rows,scope:actor.role===ROLE_ADMIN?'all':'assigned'});
}
