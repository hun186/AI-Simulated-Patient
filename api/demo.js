import { getAllCases,getPublicCases } from '../lib/cases.js';
import { mockPatientReply } from '../lib/mock-patient.js';
import { mockCoach } from '../lib/mock-coach.js';
import { mockEvaluate } from '../lib/mock-evaluator.js';
import { getPromptTemplateCatalog } from '../lib/llm/prompts.js';


function demoAiConnections(){
  return [
    {id:'demo-openai',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo OpenAI',providerKind:'openai',preset:'openai',baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-5-mini',apiKeyLast4:'',isActive:true},
    {id:'demo-deepseek',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo DeepSeek',providerKind:'openai_compatible',preset:'deepseek',baseUrl:'https://api.deepseek.com',defaultModel:'deepseek-flash',apiKeyLast4:'',isActive:true},
    {id:'demo-groq',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo GroqCloud',providerKind:'openai_compatible',preset:'groq',baseUrl:'https://api.groq.com/openai/v1',defaultModel:'openai/gpt-oss-120b',apiKeyLast4:'',isActive:true},
    {id:'demo-ollama-cloud',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo Ollama Cloud',providerKind:'openai_compatible',preset:'ollama_cloud',baseUrl:'https://ollama.com/v1',defaultModel:'deepseek-v4-pro',apiKeyLast4:'',isActive:true},
    {id:'demo-ollama-local',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo Ollama Local',providerKind:'openai_compatible',preset:'ollama',baseUrl:'http://192.168.1.50:11434/v1',defaultModel:'qwen3:latest',apiKeyLast4:'',isActive:true},
    {id:'demo-dify',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo Dify Chatflow',providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',defaultModel:'chat',apiKeyLast4:'',isActive:true}
  ];
}

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
function teacherCase(item){
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
    return res.status(200).json({mode:'demo',cases:getPublicCases()});
  }
  if(route==='teacher-cases'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({mode:'demo',cases:getAllCases().map(teacherCase)});
  }
  if(route==='ai-settings'){
    if(req.method!=='GET'){
      return res.status(409).json({
        error:'VERCEL_DEMO_READ_ONLY',
        message:'Vercel Demo 僅展示 LLM Provider / Agent Route / Prompt Template 介面，不儲存設定，也不實際呼叫 LLM。'
      });
    }
    return res.status(200).json({
      mode:'demo',
      demoReadOnly:true,
      demoNote:'Vercel Demo 僅展示 LLM Provider、Agent Route 與 Prompt Template 介面；設定不會儲存，也不會實際呼叫 LLM。',
      connections:demoAiConnections(),
      routes:[],
      actorRole:'demo',
      promptTemplates:getPromptTemplateCatalog()
    });
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
