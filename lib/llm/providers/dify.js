import { LlmProviderError,errorForStatus,invalidResponse,normalizeFetchError } from '../errors.js';

const DEFAULT_DIFY_BASE_URL='https://api.dify.ai/v1';

function cleanBase(value){
  return String(value||'').trim().replace(/\/+$/,'')||DEFAULT_DIFY_BASE_URL;
}

function modeFor(request){
  return String(request.model||request.connection?.defaultModel||'chat').trim().toLowerCase();
}

function promptText(request){
  const parts=[];
  if(request.systemPrompt) parts.push('SYSTEM INSTRUCTIONS:\n'+String(request.systemPrompt));
  for(const item of request.messages||[]){
    const role=String(item?.role||'user').toUpperCase();
    parts.push(role+':\n'+String(item?.content??''));
  }
  return parts.join('\n\n');
}

function latestUserText(request){
  const messages=Array.isArray(request?.messages)?request.messages:[];
  for(let index=messages.length-1;index>=0;index-=1){
    if(messages[index]?.role==='user') return String(messages[index]?.content??'');
  }
  return '';
}

function executionMode(config){
  return String(config?.difyExecutionMode||'platform_managed').trim().toLowerCase();
}

function configOf(request){
  const value=request?.providerConfig;
  return value&&typeof value==='object'?value:{};
}

function staticInputs(config){
  const value=config?.difyInputs;
  return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
}

function firstTextOutput(outputs,preferredKey=''){
  if(!outputs||typeof outputs!=='object') return '';
  if(preferredKey && typeof outputs[preferredKey]==='string') return outputs[preferredKey];
  for(const value of Object.values(outputs)){
    if(typeof value==='string'&&value.length) return value;
  }
  return '';
}

function extractText(data,mode,config){
  if(mode==='workflow'){
    const outputs=data?.data?.outputs||data?.outputs||{};
    return firstTextOutput(outputs,String(config.difyOutputKey||'text').trim());
  }
  return typeof data?.answer==='string'?data.answer:'';
}

function usageOf(data){
  const usage=data?.metadata?.usage||data?.usage||data?.data?.usage||{};
  const totalFromWorkflow=Number(data?.data?.total_tokens||data?.total_tokens||0);
  const inputTokens=Number(usage.prompt_tokens||usage.input_tokens||0);
  const outputTokens=Number(usage.completion_tokens||usage.output_tokens||0);
  return {
    inputTokens,
    cachedInputTokens:Number(usage.prompt_cache_hit_tokens||usage.cached_input_tokens||0),
    outputTokens,
    reasoningTokens:Number(usage.reasoning_tokens||0),
    totalTokens:Number(usage.total_tokens||totalFromWorkflow||inputTokens+outputTokens||0)
  };
}

function endpointFor(mode){
  if(mode==='workflow') return '/workflows/run';
  if(mode==='completion') return '/completion-messages';
  if(mode==='chat') return '/chat-messages';
  throw invalidResponse();
}

export async function generateDify(request,{fetchImpl=fetch}={}){
  const mode=modeFor(request);
  const baseUrl=cleanBase(request.connection?.baseUrl);
  const apiKey=String(request.connection?.apiKey||'');
  if(!apiKey||!['chat','workflow','completion'].includes(mode)) throw invalidResponse();

  const config=configOf(request);
  const combinedPrompt=promptText(request);
  const user=String(request.safetyIdentifier||'aisp-user');
  const inputs=staticInputs(config);
  const execution=executionMode(config);
  const stateful=execution==='stateful_chatflow';
  if(stateful && mode!=='chat') throw new LlmProviderError('invalid_request');
  let body;

  if(mode==='workflow'){
    const inputKey=String(config.difyInputKey||'prompt').trim()||'prompt';
    body={inputs:{...inputs,[inputKey]:combinedPrompt},response_mode:'blocking',user};
  }else if(mode==='chat'){
    const conversationId=stateful?String(request?.providerState?.conversationId||''):'';
    if(stateful && request?.requireProviderState && !conversationId){
      throw new LlmProviderError('dify_conversation_state_missing');
    }
    body={
      inputs,
      query:stateful?String(request?.difyQueryOverride??latestUserText(request)):combinedPrompt,
      response_mode:'blocking',
      user,
      conversation_id:conversationId
    };
  }else{
    body={inputs,query:combinedPrompt,response_mode:'blocking',user};
  }

  const controller=new AbortController();
  const timeoutMs=Math.max(1,Number(request.timeoutMs||60000));
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const started=Date.now();
  let response;
  try{
    response=await fetchImpl(baseUrl+endpointFor(mode),{
      method:'POST',
      headers:{'content-type':'application/json',Authorization:'Bearer '+apiKey},
      body:JSON.stringify(body),
      signal:controller.signal
    });
  }catch(error){
    throw normalizeFetchError(error);
  }finally{
    clearTimeout(timer);
  }

  if(!response?.ok) throw errorForStatus(Number(response?.status||500));
  let data;
  try{data=await response.json();}
  catch(error){throw invalidResponse(error);}
  const text=extractText(data,mode,config);
  if(!text) throw invalidResponse();
  const usage=usageOf(data);
  const hasUsage=Object.values(usage).some(value=>Number(value)>0);
  let providerState=null;
  if(execution==='stateful_chatflow'){
    const conversationId=String(data?.conversation_id||request?.providerState?.conversationId||'');
    if(!conversationId) throw invalidResponse();
    providerState={conversationId};
  }
  return {
    text,
    usageStatus:hasUsage?'reported':'unreported',
    provider:'dify',
    preset:'dify',
    model:mode,
    usage,
    providerState,
    latencyMs:Math.max(0,Date.now()-started),
    providerRequestId:data?.message_id||data?.workflow_run_id||data?.data?.id||data?.task_id||null
  };
}

export async function testDifyConnection(connection,{fetchImpl=fetch}={}){
  const baseUrl=cleanBase(connection?.baseUrl);
  const apiKey=String(connection?.apiKey||'');
  if(!apiKey) throw invalidResponse();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  const started=Date.now();
  let response;
  try{
    response=await fetchImpl(baseUrl+'/parameters?user=aisp-connection-test',{
      method:'GET',
      headers:{Authorization:'Bearer '+apiKey},
      signal:controller.signal
    });
  }catch(error){
    throw normalizeFetchError(error);
  }finally{
    clearTimeout(timer);
  }
  if(!response?.ok) throw errorForStatus(Number(response?.status||500));
  try{await response.json();}
  catch(error){throw invalidResponse(error);}
  return {ok:true,provider:'dify',preset:'dify',model:String(connection?.defaultModel||'chat'),latencyMs:Math.max(0,Date.now()-started)};
}
