import { query } from './db.js';
import { getCase } from './cases.js';

export async function ensureBuiltinCase() {
  const item=getCase('aphasia_001');
  await query(
    `insert into cases (id,version,internal_title,student_label,difficulty,student_brief,definition_json,status)
     values ($1,1,$2,$3,$4,$5,$6::jsonb,'published')
     on conflict (id) do nothing`,
    [item.id,item.title,item.studentLabel,item.difficulty,item.studentBrief,JSON.stringify(item)]
  );
}

export function publicProjection(row) {
  const def=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
  return {
    id:row.id,
    studentLabel:row.student_label,
    difficulty:row.difficulty,
    studentBrief:row.student_brief,
    patient:{name:def.patient?.name,age:def.patient?.age,gender:def.patient?.gender},
    opening:def.opening
  };
}

export async function listStudentCases() {
  await ensureBuiltinCase();
  const rows=await query("select * from cases where status='published' order by created_at asc");
  return rows.map(publicProjection);
}

export async function getCaseDefinition(caseId) {
  await ensureBuiltinCase();
  const rows=await query('select * from cases where id=$1 limit 1',[caseId]);
  if(!rows[0]) return null;
  const row=rows[0];
  const definition=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
  return {row,definition};
}

export async function listTeacherCases() {
  await ensureBuiltinCase();
  const rows=await query('select * from cases order by updated_at desc');
  return rows.map(row=>{
    const def=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
    return {
      id:row.id,version:row.version,internalTitle:row.internal_title,studentLabel:row.student_label,
      difficulty:row.difficulty,status:row.status,learningGoals:def.learningGoals||[],
      patient:{name:def.patient?.name,age:def.patient?.age,gender:def.patient?.gender},
      rubric:(def.rubric||[]).map(({id,label,points})=>({id,label,points}))
    };
  });
}
