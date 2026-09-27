import { query } from './db.js';

function parseJson(value,fallback=null){
  if(value==null)return fallback;
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return fallback;}
}

export async function saveEvaluationFailureDiagnostic({diagnostic,sessionId,studentUserId}){
  await query(
    `insert into evaluation_failure_diagnostics
      (error_id,session_id,student_user_id,diagnostic_json)
     values ($1,$2,$3,$4::jsonb)
     on conflict (error_id) do update set diagnostic_json=excluded.diagnostic_json`,
    [diagnostic.errorId,sessionId,studentUserId,JSON.stringify(diagnostic)]
  );
}

export async function getEvaluationFailureDiagnosticForActor(errorId,actor){
  if(!errorId||!actor||!['admin','teacher'].includes(actor.role))return null;
  const rows=actor.role==='admin'
    ?await query(
      `select d.error_id as "errorId",d.session_id as "sessionId",
        d.student_user_id as "studentUserId",d.diagnostic_json as diagnostic,d.created_at as "createdAt"
       from evaluation_failure_diagnostics d
       where d.error_id=$1 limit 1`,
      [errorId]
    )
    :await query(
      `select d.error_id as "errorId",d.session_id as "sessionId",
        d.student_user_id as "studentUserId",d.diagnostic_json as diagnostic,d.created_at as "createdAt"
       from evaluation_failure_diagnostics d
       where d.error_id=$1 and (
         d.student_user_id=$2 or exists (
           select 1 from teacher_student_assignments a
           where a.teacher_user_id=$2 and a.student_user_id=d.student_user_id
         )
       ) limit 1`,
      [errorId,actor.id]
    );
  const row=rows[0];
  if(!row)return null;
  return {...row,diagnostic:parseJson(row.diagnostic,{})};
}
