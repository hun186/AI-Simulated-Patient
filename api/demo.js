import { getCase,getPublicCase } from '../lib/cases.js';
import { mockPatientReply } from '../lib/mock-patient.js';
import { mockCoach } from '../lib/mock-coach.js';
import { mockEvaluate } from '../lib/mock-evaluator.js';

function routeOf(req){
  if(req.query?.route) return String(req.query.route);
  try{return new URL(req.url||'', 'http://localhost').searchParams.get('route')||'';}
  catch{return '';}
}
function requireMethod(req,res,method){
  if(req.method===method) return true;
  res.status(405).json({error:'Method not allowed'});
  return false;
}
function teacherCase(){
  const item=getCase('aphasia_001');
  return {
    id:item.id,internalTitle:item.title,studentLabel:item.studentLabel,difficulty:item.difficulty,
    learningGoals:item.learningGoals||[],
    patient:{name:item.patient.name,age:item.patient.age,gender:item.patient.gender},
    rubric:item.rubric.map(({id,label,points})=>({id,label,points}))
  };
}

export default async function handler(req,res){
  const route=routeOf(req);
  if(route==='runtime'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({
      persistence:'browser',auth:false,demoAuth:true,
      database:{driver:'browser',schemaVersion:null,wal:false},
      needsBootstrap:false,needsAdminMigration:false,llmProvider:'mock'
    });
  }
  if(route==='health'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({ok:true,mode:'demo',database:'disabled',driver:'browser',demoAuth:true});
  }
  if(route==='cases'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({mode:'demo',cases:[getPublicCase('aphasia_001')]});
  }
  if(route==='teacher-cases'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({mode:'demo',cases:[teacherCase()]});
  }
  if(route==='chat'){
    if(!requireMethod(req,res,'POST')) return;
    const {caseId='aphasia_001',caseDefinition=null,message='',revealedFactIds=[]}=req.body??{};
    if(!String(message).trim()) return res.status(400).json({error:'message is required'});
    try{return res.status(200).json(mockPatientReply({caseId,caseDefinition,message,revealedFactIds}));}
    catch(error){
      if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      console.error(error);return res.status(500).json({error:'Unexpected error'});
    }
  }
  if(route==='coach'){
    if(!requireMethod(req,res,'POST')) return;
    const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[]}=req.body??{};
    try{return res.status(200).json(mockCoach({caseId,caseDefinition,transcript,revealedFactIds}));}
    catch(error){
      if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      console.error(error);return res.status(500).json({error:'Unexpected error'});
    }
  }
  if(route==='evaluate'){
    if(!requireMethod(req,res,'POST')) return;
    const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],mode='exam'}=req.body??{};
    try{return res.status(200).json(mockEvaluate({caseId,caseDefinition,transcript,revealedFactIds,mode}));}
    catch(error){
      if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      console.error(error);return res.status(500).json({error:'Unexpected error'});
    }
  }
  return res.status(404).json({error:'Demo route not found'});
}
