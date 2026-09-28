import { createHash } from 'node:crypto';
import { generateLlm } from './provider-gateway.js';
import { getConnectionForUse } from './connections.js';
import {
  buildPatientPrompt,buildCoachPrompt,buildCoachTask,
  buildEvaluatorPrompt,buildEvaluatorTask,buildEvaluatorRepairPrompt,buildEvaluatorRepairTask,
  evaluationResponseFormat
} from './prompts.js';
import { parseValidateEvaluationWithTrace } from './evaluation-contract.js';

function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){
    try{return JSON.parse(value);}catch{return fallback;}
  }
  return value&&typeof value==='object'?value:fallback;
}

function safetyIdentifier(session){
  const raw=String(session?.student_user_id??session?.studentUserId??session?.user_id??'anonymous');
  return 'aisp_'+createHash('sha256').update(raw).digest('hex').slice(0,32);
}

async function requestFor({session,route,messages,systemPrompt,responseFormat=null,connectionLoader,defaultThinkingMode=null,defaultServiceTier=null,defaultMaxOutputTokens=null,defaultReasoningEffort=null,defaultIncludeReasoning=null,providerState=null,requireProviderState=false,difyQueryOverride=null}){
  if(!route || route.preset==='mock') {
    const error=new Error('AI_PROVIDER_NOT_CONFIGURED');
    error.code='AI_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const connection=route.connection || await connectionLoader(route.connectionId);
  const config=parseJson(route.config,{});
  return {
    connection,
    model:route.model||connection.defaultModel,
    systemPrompt,
    messages,
    responseFormat,
    safetyIdentifier:safetyIdentifier(session),
    temperature:config.temperature,
    maxOutputTokens:config.maxOutputTokens??config.max_output_tokens??defaultMaxOutputTokens,
    thinkingMode:config.thinkingMode??config.thinking_mode??defaultThinkingMode,
    reasoningEffort:config.reasoningEffort??config.reasoning_effort??defaultReasoningEffort,
    includeReasoning:config.includeReasoning??config.include_reasoning??defaultIncludeReasoning,
    serviceTier:config.serviceTier??config.service_tier??defaultServiceTier,
    timeoutMs:config.timeoutMs??config.timeout_ms,
    providerConfig:config,
    providerState,
    requireProviderState:Boolean(requireProviderState),
    difyQueryOverride
  };
}

function transcriptMessages(transcript=[]){
  return transcript
    .filter(item=>item && ['student','patient'].includes(item.role))
    .map(item=>({
      role:item.role==='student'?'user':'assistant',
      content:String(item.content??'')
    }));
}

function isGroqGptOss(route){
  return route?.preset==='groq' && /^openai\/gpt-oss-(20b|120b)$/.test(String(route?.model||''));
}

function groqDefaults(route,maxOutputTokens){
  if(route?.preset!=='groq') return {};
  return {
    defaultMaxOutputTokens:maxOutputTokens,
    defaultReasoningEffort:isGroqGptOss(route)?'low':null,
    defaultIncludeReasoning:isGroqGptOss(route)?false:null
  };
}

function difyFinalTrigger(route){
  if(route?.preset!=='dify') return null;
  const config=parseJson(route?.config,{});
  if(String(config.difyExecutionMode||'platform_managed')!=='stateful_chatflow') return null;
  if(!config.difyFinalTriggerEnabled) return null;
  return String(config.difyFinalTrigger||'問診結束').trim()||'問診結束';
}

export async function runPatientAgent({
  session,message,transcript=[],route,providerState=null,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const messages=transcriptMessages(transcript);
  messages.push({role:'user',content:String(message??'')});
  const request=await requestFor({
    session,route,messages,connectionLoader,providerState,
    systemPrompt:buildPatientPrompt({session,customTemplate:parseJson(route?.config,{}).promptTemplate||''}),
    defaultThinkingMode:route?.preset==='deepseek'?'disabled':null,
    ...groqDefaults(route,1024),
    defaultServiceTier:route?.preset==='openai'?'default':null
  });
  const result=await generateLlm(request,{fetchImpl});
  return {...result,reply:result.text,safetyIdentifier:request.safetyIdentifier};
}

export async function runCoachAgent({
  session,transcript=[],route,providerState=null,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const request=await requestFor({
    session,route,connectionLoader,providerState,
    messages:[{role:'user',content:buildCoachTask({transcript})}],
    systemPrompt:buildCoachPrompt({session,customTemplate:parseJson(route?.config,{}).promptTemplate||''}),
    defaultThinkingMode:route?.preset==='deepseek'?'disabled':null,
    ...groqDefaults(route,1024),
    defaultServiceTier:route?.preset==='openai'?'default':null
  });
  const result=await generateLlm(request,{fetchImpl});
  return {...result,guidance:result.text,safetyIdentifier:request.safetyIdentifier};
}

export async function repairEvaluatorAgent({
  session,transcript=[],route,invalidOutput='',validationError=null,providerState=null,
  fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const finalTrigger=difyFinalTrigger(route);
  const config=parseJson(route?.config,{});
  const repairMessage=finalTrigger||buildEvaluatorRepairTask({
    transcript,invalidOutput,validationError
  });
  const request=await requestFor({
    session,route,connectionLoader,providerState,
    requireProviderState:Boolean(finalTrigger),
    difyQueryOverride:finalTrigger,
    messages:[{role:'user',content:repairMessage}],
    systemPrompt:buildEvaluatorRepairPrompt({
      session,
      customTemplate:config.promptTemplate||'',
      feedbackTemplate:config.feedbackTemplate||''
    }),
    responseFormat:evaluationResponseFormat(),
    defaultThinkingMode:route?.preset==='deepseek'?'disabled':null,
    defaultMaxOutputTokens:route?.preset==='deepseek'?8192:null,
    ...groqDefaults(route,8192),
    defaultServiceTier:route?.preset==='openai'?'default':null
  });
  const result=await generateLlm(request,{fetchImpl});
  let parsed;
  try{parsed=parseValidateEvaluationWithTrace(result.text);}
  catch(error){
    error.llmResult=result;
    error.code='EVALUATION_REPAIR_FAILED';
    throw error;
  }
  return {
    ...result,
    evaluation:parsed.evaluation,
    normalization:parsed.normalization,
    safetyIdentifier:request.safetyIdentifier,
    repaired:true
  };
}

export async function runEvaluatorAgent({
  session,transcript=[],route,providerState=null,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const finalTrigger=difyFinalTrigger(route);
  const config=parseJson(route?.config,{});
  const evaluatorMessage=finalTrigger||buildEvaluatorTask({transcript});
  const request=await requestFor({
    session,route,connectionLoader,providerState,
    requireProviderState:Boolean(finalTrigger),
    difyQueryOverride:finalTrigger,
    messages:[{role:'user',content:evaluatorMessage}],
    systemPrompt:buildEvaluatorPrompt({
      session,
      customTemplate:config.promptTemplate||'',
      feedbackTemplate:config.feedbackTemplate||''
    }),
    responseFormat:evaluationResponseFormat(),
    defaultThinkingMode:route?.preset==='deepseek'?'disabled':null,
    defaultMaxOutputTokens:route?.preset==='deepseek'?8192:null,
    ...groqDefaults(route,8192),
    defaultServiceTier:route?.preset==='openai'?'default':null
  });
  const result=await generateLlm(request,{fetchImpl});
  let parsed;
  try{parsed=parseValidateEvaluationWithTrace(result.text);}
  catch(error){error.llmResult=result;throw error;}
  return {
    ...result,
    evaluation:parsed.evaluation,
    normalization:parsed.normalization,
    safetyIdentifier:request.safetyIdentifier
  };
}
