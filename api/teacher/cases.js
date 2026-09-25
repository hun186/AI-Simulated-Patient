import { getCase } from '../../lib/cases.js';

export default function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const item=getCase('aphasia_001');
  return res.status(200).json({cases:[{
    id:item.id,
    internalTitle:item.title,
    studentLabel:item.studentLabel,
    difficulty:item.difficulty,
    learningGoals:item.learningGoals||[],
    patient:{name:item.patient.name,age:item.patient.age,gender:item.patient.gender},
    rubric:item.rubric.map(({id,label,points})=>({id,label,points}))
  }]});
}
