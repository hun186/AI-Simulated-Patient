import { errorForStatus,invalidResponse,normalizeFetchError } from '../errors.js';

const DEEPSEEK_BASE_URL='https://api.deepseek.com';
const OLLAMA_BASE_URL='http://127.0.0.1:11434/v1';
const OLLAMA_CLOUD_BASE_URL='https://ollama.com/v1';
const GROQ_BASE_URL='https://api.groq.com/openai/v1';

function cleanBase(value){
  return String(value||'').trim().replace(/\/+$/,'');
}

function baseUrlFor(connection){
  if(connection?.preset==='deepseek') return DEEPSEEK_BASE_URL;
  if(connection?.preset==='groq') return GROQ_BASE_URL;
  if(connection?.preset==='ollama') return cleanBase(connection.baseUrl)||OLLAMA_BASE_URL;
  if(connection?.preset==='ollama_cloud') return OLLAMA_CLOUD_BASE_URL;
  return cleanBase(connection?.baseUrl);
}

function modelFor(request){
  return String(request.model||request.connection?.defaultModel||'').trim();
}

function preview(value,max=2000,secret=''){
  if(value===undefined||value===null) return null;
  let text=String(value);
  if(secret) text=text.split(secret).join('[REDACTED]');
  text=text.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]');
  text=text.replace(/\b(?:gsk_|sk-)[A-Za-z0-9._-]{8,}\b/g,'[REDACTED]');
  return text.length>max?text.slice(0,max)+'…':text;
}

function providerDiagnostic({response,data=null,rawText='',model='',secret=''}) {
  const message=data?.choices?.[0]?.message||{};
  const error=data?.error&&typeof data.error==='object'?data.error:null;
  const usage=data?.usage&&typeof data.usage==='object'?data.usage:null;
  return {
    httpStatus:Number(response?.status||0)||null,
    providerRequestId:data?.id||response?.headers?.get?.('x-request-id')||null,
    model:String(data?.model||model||'')||null,
    finishReason:data?.choices?.[0]?.finish_reason??null,
    content:preview(message?.content,2000,secret),
    reasoning:preview(message?.reasoning??message?.reasoning_content,2000,secret),
    usage:usage?{
      promptTokens:Number(usage.prompt_tokens||0),
      completionTokens:Number(usage.completion_tokens||0),
      reasoningTokens:Number(usage.completion_tokens_details?.reasoning_tokens||0),
      totalTokens:Number(usage.total_tokens||0)
    }:null,
    providerError:error?{
      message:preview(error.message,1000,secret),
      type:preview(error.type,200,secret),
      code:preview(error.code,200,secret),
      param:preview(error.param,200,secret)
    }:null,
    responseKeys:data&&typeof data==='object'?Object.keys(data).slice(0,30):[],
    messageKeys:message&&typeof message==='object'?Object.keys(message).slice(0,30):[],
    rawPreview:(!data&&rawText)?preview(rawText,2000,secret):null
  };
}

function usageOf(data){
  const usage=data?.usage||{};
  const inputTokens=Number(usage.prompt_tokens||0);
  const hasHit=usage.prompt_cache_hit_tokens!==undefined
    || usage.prompt_tokens_details?.cached_tokens!==undefined;
  const hasMiss=usage.prompt_cache_miss_tokens!==undefined;
  const cachedInputTokens=Number(
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  );
  const cacheMissTokens=hasMiss
    ?Number(usage.prompt_cache_miss_tokens||0)
    :(hasHit?Math.max(0,inputTokens-cachedInputTokens):0);
  return {
    inputTokens,
    cachedInputTokens,
    cacheMissTokens,
    cacheReadStatus:(hasHit||hasMiss)?'reported':'unreported',
    outputTokens:Number(usage.completion_tokens||0),
    reasoningTokens:Number(usage.completion_tokens_details?.reasoning_tokens||0),
    totalTokens:Number(usage.total_tokens||0)
  };
}

export async function generateOpenAICompatible(request,{fetchImpl=fetch}={}){
  const model=modelFor(request);
  const baseUrl=baseUrlFor(request.connection);
  if(!model||!baseUrl) throw invalidResponse();
  const messages=[];
  if(request.systemPrompt) messages.push({role:'system',content:String(request.systemPrompt)});
  for(const item of request.messages||[]){
    messages.push({role:item.role,content:String(item.content??'')});
  }
  const body={model,messages,stream:false};
  if(request.connection?.preset==='deepseek' && ['enabled','disabled'].includes(request.thinkingMode)){
    body.thinking={type:request.thinkingMode};
  }
  if(request.maxOutputTokens!=null){
    const key=request.connection?.preset==='groq'?'max_completion_tokens':'max_tokens';
    body[key]=Number(request.maxOutputTokens);
  }
  if(request.connection?.preset==='groq' && request.reasoningEffort){
    body.reasoning_effort=String(request.reasoningEffort);
  }
  if(request.connection?.preset==='groq' && typeof request.includeReasoning==='boolean'){
    body.include_reasoning=request.includeReasoning;
  }
  if(request.temperature!=null) body.temperature=Number(request.temperature);
  if(request.responseFormat){
    const type=request.responseFormat.type==='json_schema'?'json_object':request.responseFormat.type;
    if(type) body.response_format={type};
  }
  if(request.safetyIdentifier) body.user=String(request.safetyIdentifier);

  const headers={'content-type':'application/json'};
  const key=String(request.connection?.apiKey||'');
  if(key) headers.Authorization='Bearer '+key;

  const controller=new AbortController();
  const timeoutMs=Math.max(1,Number(request.timeoutMs||30000));
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const started=Date.now();
  let response;
  try{
    response=await fetchImpl(baseUrl+'/chat/completions',{
      method:'POST',headers,body:JSON.stringify(body),signal:controller.signal
    });
  }catch(error){
    throw normalizeFetchError(error);
  }finally{
    clearTimeout(timer);
  }
  let rawText='';
  let data=null;
  try{
    rawText=await response.text();
    data=rawText?JSON.parse(rawText):{};
  }catch(error){
    const wrapped=invalidResponse(error);
    wrapped.providerDiagnostic=providerDiagnostic({response,data:null,rawText,model,secret:key});
    throw wrapped;
  }
  const diagnostic=providerDiagnostic({response,data,rawText,model,secret:key});
  if(!response?.ok){
    const wrapped=errorForStatus(Number(response?.status||500));
    wrapped.providerDiagnostic=diagnostic;
    throw wrapped;
  }
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string' || !text.length){
    const wrapped=invalidResponse();
    wrapped.providerDiagnostic=diagnostic;
    throw wrapped;
  }
  const usageStatus=data?.usage&&typeof data.usage==='object'?'reported':'unreported';
  return {
    text,
    usageStatus,
    provider:'openai_compatible',
    preset:String(request.connection?.preset||'custom'),
    model:String(data.model||model),
    usage:usageOf(data),
    latencyMs:Math.max(0,Date.now()-started),
    providerRequestId:data.id||response.headers?.get?.('x-request-id')||null,
    diagnostic
  };
}
