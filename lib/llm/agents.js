import { createHash } from 'node:crypto';
import { generateLlm } from './provider-gateway.js';
import { getConnectionForUse } from './connections.js';
import {
  buildPatientPrompt,buildCoachPrompt,buildEvaluatorPrompt,evaluationResponseFormat
} from './prompts.js';
import { parseAndValidateEvaluation } from './evaluation-contract.js';

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

async function requestFor({session,route,messages,systemPrompt,responseFormat=null,connectionLoader}){
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
    maxOutputTokens:config.maxOutputTokens??config.max_output_tokens,
    timeoutMs:config.timeoutMs??config.timeout_ms
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

export async function runPatientAgent({
  session,message,transcript=[],route,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const messages=transcriptMessages(transcript);
  messages.push({role:'user',content:String(message??'')});
  const request=await requestFor({
    session,route,messages,connectionLoader,
    systemPrompt:buildPatientPrompt({session})
  });
  const result=await generateLlm(request,{fetchImpl});
  return {...result,reply:result.text,safetyIdentifier:request.safetyIdentifier};
}

export async function runCoachAgent({
  session,transcript=[],route,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const request=await requestFor({
    session,route,connectionLoader,
    messages:[{role:'user',content:'Provide the next coaching hint based on the transcript.'}],
    systemPrompt:buildCoachPrompt({session,transcript})
  });
  const result=await generateLlm(request,{fetchImpl});
  return {...result,guidance:result.text,safetyIdentifier:request.safetyIdentifier};
}

export async function runEvaluatorAgent({
  session,transcript=[],route,fetchImpl=fetch,connectionLoader=getConnectionForUse
}){
  const request=await requestFor({
    session,route,connectionLoader,
    messages:[{role:'user',content:'Evaluate the completed interview using the required JSON contract.'}],
    systemPrompt:buildEvaluatorPrompt({session,transcript}),
    responseFormat:evaluationResponseFormat()
  });
  const result=await generateLlm(request,{fetchImpl});
  let evaluation;
  try{evaluation=parseAndValidateEvaluation(result.text);}
  catch(error){error.llmResult=result;throw error;}
  return {...result,evaluation,safetyIdentifier:request.safetyIdentifier};
}
