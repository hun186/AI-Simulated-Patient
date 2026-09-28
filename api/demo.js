import { getAllCases,getPublicCases,resolveCase } from '../lib/cases.js';
import { mockPatientReply } from '../lib/mock-patient.js';
import { mockCoach } from '../lib/mock-coach.js';
import { mockEvaluate } from '../lib/mock-evaluator.js';
import {
  buildPatientPrompt,buildCoachPrompt,buildCoachTask,
  buildEvaluatorPrompt,buildEvaluatorTask,evaluationResponseFormat,getPromptTemplateCatalog
} from '../lib/llm/prompts.js';

const GROQ_BASE_URL='https://api.groq.com/openai/v1';
const GROQ_DEMO_MODELS=new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b'
]);

function demoAiConnections(){
  return [
    {id:'demo-openai',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo OpenAI',providerKind:'openai',preset:'openai',baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-5-mini',apiKeyLast4:'',isActive:true},
    {id:'demo-deepseek',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo DeepSeek',providerKind:'openai_compatible',preset:'deepseek',baseUrl:'https://api.deepseek.com',defaultModel:'deepseek-flash',apiKeyLast4:'',isActive:true},
    {id:'demo-groq',scopeType:'teacher',ownerUserId:'demo-teacher',name:'Demo GroqCloud',providerKind:'openai_compatible',preset:'groq',baseUrl:GROQ_BASE_URL,defaultModel:'openai/gpt-oss-120b',apiKeyLast4:'',isActive:true},
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
function cleanText(value,max=400){
  return String(value??'').trim().slice(0,max);
}
function byokConfig(body){
  const value=body?.demoByok;
  if(!value || value.provider!=='groq') return null;
  const apiKey=cleanText(value.apiKey,512);
  const model=cleanText(value.model,160);
  if(!apiKey) {
    const error=new Error('GROQ_API_KEY_REQUIRED');
    error.code='GROQ_API_KEY_REQUIRED';
    throw error;
  }
  if(!GROQ_DEMO_MODELS.has(model)){
    const error=new Error('GROQ_DEMO_MODEL_NOT_ALLOWED');
    error.code='GROQ_DEMO_MODEL_NOT_ALLOWED';
    throw error;
  }
  return {apiKey,model};
}
function groqErrorStatus(status){
  if(status===401||status===403) return {status:401,code:'GROQ_AUTHENTICATION_FAILED'};
  if(status===429) return {status:429,code:'GROQ_RATE_LIMITED'};
  if(status===404) return {status:400,code:'GROQ_MODEL_NOT_FOUND'};
  if(status>=400&&status<500) return {status:400,code:'GROQ_INVALID_REQUEST'};
  return {status:502,code:'GROQ_UPSTREAM_UNAVAILABLE'};
}
async function groqFetch(path,{apiKey,method='POST',body=null,timeoutMs=30000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(GROQ_BASE_URL+path,{
      method,
      headers:{
        Authorization:'Bearer '+apiKey,
        ...(body?{'content-type':'application/json'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:controller.signal
    });
    const text=await response.text();
    let data={};
    if(text){try{data=JSON.parse(text);}catch{data={};}}
    if(!response.ok){
      const mapped=groqErrorStatus(response.status);
      const error=new Error(mapped.code);
      error.code=mapped.code;
      error.httpStatus=mapped.status;
      throw error;
    }
    return data;
  }catch(error){
    if(error?.name==='AbortError'){
      const timeout=new Error('GROQ_TIMEOUT');
      timeout.code='GROQ_TIMEOUT';
      timeout.httpStatus=504;
      throw timeout;
    }
    if(error?.code) throw error;
    const unavailable=new Error('GROQ_UPSTREAM_UNAVAILABLE');
    unavailable.code='GROQ_UPSTREAM_UNAVAILABLE';
    unavailable.httpStatus=502;
    throw unavailable;
  }finally{
    clearTimeout(timer);
  }
}
async function groqChat({apiKey,model,messages,maxTokens=400,temperature=0.4,responseFormat=null}){
  const data=await groqFetch('/chat/completions',{
    apiKey,
    body:{
      model,messages,max_tokens:maxTokens,temperature,
      ...(responseFormat?{response_format:responseFormat}:{})
    }
  });
  const content=String(data?.choices?.[0]?.message?.content??'').trim();
  if(!content){
    const error=new Error('GROQ_INVALID_RESPONSE');
    error.code='GROQ_INVALID_RESPONSE';
    error.httpStatus=502;
    throw error;
  }
  return {
    content,
    usage:data.usage||null,
    requestId:data.id||null
  };
}
async function testGroqByok(config){
  const data=await groqFetch('/models',{apiKey:config.apiKey,method:'GET',timeoutMs:12000});
  const available=Array.isArray(data?.data)&&data.data.some(item=>item?.id===config.model);
  if(!available){
    const error=new Error('GROQ_MODEL_NOT_AVAILABLE');
    error.code='GROQ_MODEL_NOT_AVAILABLE';
    error.httpStatus=400;
    throw error;
  }
  return {ok:true,provider:'groq',model:config.model,modelAvailable:true};
}
function sessionForCase(caseData,mode='training'){
  return {case_snapshot:caseData,mode};
}
function chatMessagesFromTranscript(transcript=[]){
  return (Array.isArray(transcript)?transcript:[]).slice(-30).map(item=>({
    role:item?.role==='patient'?'assistant':'user',
    content:String(item?.content??'')
  })).filter(item=>item.content);
}
function safeJsonObject(text){
  try{
    const value=JSON.parse(text);
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }catch{return {};}
}
function stringList(value){
  return Array.isArray(value)?value.map(item=>cleanText(item,1200)).filter(Boolean).slice(0,8):[];
}
function normalizedEvaluation(raw,caseData,mode){
  const rubric=Array.isArray(caseData?.rubric)?caseData.rubric:[];
  const rawItems=Array.isArray(raw?.items)?raw.items:[];
  const items=rubric.map(criterion=>{
    const source=rawItems.find(item=>item?.id===criterion.id)||{};
    const maxScore=Math.max(0,Number(criterion.points)||0);
    const numeric=Number(source.score);
    const score=Number.isFinite(numeric)?Math.max(0,Math.min(maxScore,numeric)):0;
    const status=['covered','partial','missed'].includes(source.status)
      ?source.status
      :(score>=maxScore&&maxScore>0?'covered':score>0?'partial':'missed');
    const evidence=(Array.isArray(source.evidence)?source.evidence:[])
      .filter(item=>item&&Number.isInteger(Number(item.turn))&&typeof item.quote==='string')
      .slice(0,8)
      .map(item=>({turn:Number(item.turn),quote:cleanText(item.quote,1200)}));
    return {
      id:criterion.id,
      criterion:cleanText(source.criterion||criterion.label||criterion.id,600),
      status,score,maxScore,evidence,
      reasoning:cleanText(source.reasoning||'',2000)
    };
  });
  const totalScore=items.reduce((sum,item)=>sum+item.score,0);
  const maxScore=items.reduce((sum,item)=>sum+item.maxScore,0);
  const percentage=maxScore?Math.round(totalScore/maxScore*100):0;
  const overall=raw?.overall&&typeof raw.overall==='object'?raw.overall:{};
  return {
    provider:'groq',
    judgeVersion:'vercel-byok-v1',
    mode,totalScore,maxScore,percentage,items,
    overall:{
      comment:cleanText(overall.comment||'已完成 AI 評量。',3000),
      strengths:stringList(overall.strengths),
      improvements:stringList(overall.improvements),
      recommendations:stringList(overall.recommendations),
      nextPracticeFocus:cleanText(overall.nextPracticeFocus||'依評量結果選擇一項優先練習目標。',1200)
    }
  };
}
async function livePatient(body,config){
  const caseData=resolveCase(body.caseId||'aphasia_001',body.caseDefinition||null);
  if(!caseData){
    const error=new Error('CASE_NOT_FOUND');error.code='CASE_NOT_FOUND';error.httpStatus=404;throw error;
  }
  const transcript=Array.isArray(body.transcript)?body.transcript:[];
  const session=sessionForCase(caseData,body.mode||'training');
  const result=await groqChat({
    ...config,maxTokens:320,temperature:0.45,
    messages:[
      {role:'system',content:buildPatientPrompt({session})},
      ...chatMessagesFromTranscript(transcript)
    ]
  });
  const deterministic=mockPatientReply({
    caseId:caseData.id,caseDefinition:body.caseDefinition||null,
    message:String(body.message||''),revealedFactIds:body.revealedFactIds||[]
  });
  return {
    reply:result.content,
    revealedFactIds:deterministic.revealedFactIds,
    newlyRevealedFactIds:deterministic.newlyRevealedFactIds,
    interactionRuleId:deterministic.interactionRuleId||null,
    provider:'groq',model:config.model,usage:result.usage,providerRequestId:result.requestId
  };
}
async function liveCoach(body,config){
  const caseData=resolveCase(body.caseId||'aphasia_001',body.caseDefinition||null);
  if(!caseData){
    const error=new Error('CASE_NOT_FOUND');error.code='CASE_NOT_FOUND';error.httpStatus=404;throw error;
  }
  const transcript=Array.isArray(body.transcript)?body.transcript:[];
  const session=sessionForCase(caseData,body.mode||'training');
  const baseline=mockCoach({
    caseId:caseData.id,caseDefinition:body.caseDefinition||null,
    transcript,revealedFactIds:body.revealedFactIds||[]
  });
  const result=await groqChat({
    ...config,maxTokens:260,temperature:0.3,
    responseFormat:{type:'json_object'},
    messages:[
      {role:'system',content:buildCoachPrompt({session})},
      {role:'user',content:buildCoachTask({transcript})+'\nReturn JSON only with exactly these keys: nextHint, reflectionPrompt.'}
    ]
  });
  const parsed=safeJsonObject(result.content);
  return {
    ...baseline,
    provider:'groq',coachVersion:'vercel-byok-v1',model:config.model,
    nextHint:cleanText(parsed.nextHint||baseline.nextHint,1600),
    reflectionPrompt:cleanText(parsed.reflectionPrompt||baseline.reflectionPrompt,1600),
    usage:result.usage,providerRequestId:result.requestId
  };
}
async function liveEvaluate(body,config){
  const caseData=resolveCase(body.caseId||'aphasia_001',body.caseDefinition||null);
  if(!caseData){
    const error=new Error('CASE_NOT_FOUND');error.code='CASE_NOT_FOUND';error.httpStatus=404;throw error;
  }
  const transcript=Array.isArray(body.transcript)?body.transcript:[];
  const mode=body.mode||'exam';
  const session=sessionForCase(caseData,mode);
  const format=evaluationResponseFormat();
  const result=await groqChat({
    ...config,maxTokens:2200,temperature:0.1,
    responseFormat:{
      type:'json_schema',
      json_schema:{name:format.name,strict:format.strict,schema:format.schema}
    },
    messages:[
      {role:'system',content:buildEvaluatorPrompt({session})},
      {role:'user',content:buildEvaluatorTask({transcript})}
    ]
  });
  const normalized=normalizedEvaluation(safeJsonObject(result.content),caseData,mode);
  return {
    ...normalized,
    feedback:[...normalized.overall.strengths,...normalized.overall.improvements],
    note:'Vercel BYOK Live Demo：本次評量由使用者自己的 Groq API Key 呼叫 GroqCloud。',
    model:config.model,usage:result.usage,providerRequestId:result.requestId
  };
}
function liveError(res,error){
  const status=Number(error?.httpStatus)||500;
  const code=String(error?.code||'GROQ_LIVE_DEMO_FAILED');
  return res.status(status).json({error:code});
}

export default async function handler(req,res){
  const route=routeOf(req);
  if(route==='runtime'){
    if(!requireMethod(req,res,'GET')) return;
    return res.status(200).json({
      persistence:'browser',auth:false,demoAuth:true,
      database:{driver:'browser',schemaVersion:null,wal:false},
      needsBootstrap:false,needsAdminMigration:false,llmProvider:'mock-or-byok'
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
        message:'Vercel Demo 的正式 AI Settings 仍為唯讀；Live Demo 請使用頁首的 Groq BYOK 精靈。'
      });
    }
    return res.status(200).json({
      mode:'demo',
      demoReadOnly:true,
      demoNote:'Vercel Demo 的正式 Provider/Route 設定仍為唯讀；可從頁首 Groq BYOK 精靈使用自己的 API Key 啟用 Live Demo。',
      connections:demoAiConnections(),
      routes:[],
      actorRole:'demo',
      promptTemplates:getPromptTemplateCatalog()
    });
  }
  if(route==='groq-test'){
    if(!requireMethod(req,res,'POST')) return;
    try{
      const config=byokConfig({demoByok:req.body});
      return res.status(200).json(await testGroqByok(config));
    }catch(error){return liveError(res,error);}
  }
  if(route==='chat'){
    if(!requireMethod(req,res,'POST')) return;
    const body=req.body??{};
    const {caseId='aphasia_001',caseDefinition=null,message='',revealedFactIds=[]}=body;
    if(!String(message).trim()) return res.status(400).json({error:'message is required'});
    try{
      const config=byokConfig(body);
      if(config) return res.status(200).json(await livePatient(body,config));
      return res.status(200).json(mockPatientReply({caseId,caseDefinition,message,revealedFactIds}));
    }catch(error){
      if(error?.code==='CASE_NOT_FOUND'||error?.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      return liveError(res,error);
    }
  }
  if(route==='coach'){
    if(!requireMethod(req,res,'POST')) return;
    const body=req.body??{};
    const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[]}=body;
    try{
      const config=byokConfig(body);
      if(config) return res.status(200).json(await liveCoach(body,config));
      return res.status(200).json(mockCoach({caseId,caseDefinition,transcript,revealedFactIds}));
    }catch(error){
      if(error?.code==='CASE_NOT_FOUND'||error?.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      return liveError(res,error);
    }
  }
  if(route==='evaluate'){
    if(!requireMethod(req,res,'POST')) return;
    const body=req.body??{};
    const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],mode='exam'}=body;
    try{
      const config=byokConfig(body);
      if(config) return res.status(200).json(await liveEvaluate(body,config));
      return res.status(200).json(mockEvaluate({caseId,caseDefinition,transcript,revealedFactIds,mode}));
    }catch(error){
      if(error?.code==='CASE_NOT_FOUND'||error?.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
      return liveError(res,error);
    }
  }
  return res.status(404).json({error:'Demo route not found'});
}
