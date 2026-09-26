import { randomUUID } from 'node:crypto';
import { getAllCases } from '../../lib/cases.js';
import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser,requireCsrf } from '../../lib/server-auth.js';
import { listTeacherCases } from '../../lib/server-cases.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';

export default async function handler(req,res){
  if(!isDatabaseEnabled()){
    if(req.method!=='GET') return res.status(409).json({error:'Database mode is not enabled'});
    return res.status(200).json({mode:'demo',cases:getAllCases().map((item)=>({
      id:item.id,internalTitle:item.title,studentLabel:item.studentLabel,difficulty:item.difficulty,
      learningGoals:item.learningGoals||[],patient:{name:item.patient.name,age:item.patient.age,gender:item.patient.gender},
      rubric:item.rubric.map(({id,label,points})=>({id,label,points}))
    }))});
  }

  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor) return;
  if(req.method==='GET') return res.status(200).json({mode:'production',cases:await listTeacherCases()});
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!(await requireCsrf(req,res))) return;

  const {definition,status='draft'}=req.body??{};
  if(!definition?.title || !definition?.studentLabel || !definition?.patient?.name || !definition?.opening){
    return res.status(400).json({error:'Invalid case definition'});
  }
  if(!['draft','published'].includes(status)) return res.status(400).json({error:'Invalid case status'});
  const id=definition.id || 'case_'+randomUUID();
  const def={...definition,id};
  await query(
    `insert into cases
     (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status,created_by)
     values ($1,1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [id,def.title,def.studentLabel,def.difficulty||'自訂',def.studentBrief||'',JSON.stringify(def),status,actor.id]
  );
  return res.status(201).json({id});
}
