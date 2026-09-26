import { errorForStatus,invalidResponse,normalizeFetchError } from '../errors.js';

const DEEPSEEK_BASE_URL='https://api.deepseek.com';
const OLLAMA_BASE_URL='http://127.0.0.1:11434/v1';

function cleanBase(value){
  return String(value||'').trim().replace(/\/+$/,'');
}

function baseUrlFor(connection){
  if(connection?.preset==='deepseek') return DEEPSEEK_BASE_URL;
  if(connection?.preset==='ollama') return cleanBase(connection.baseUrl)||OLLAMA_BASE_URL;
  return cleanBase(connection?.baseUrl);
}

function modelFor(request){
  return String(request.model||request.connection?.defaultModel||'').trim();
}

function usageOf(data){
  const usage=data?.usage||{};
  return {
    inputTokens:Number(usage.prompt_tokens||0),
    cachedInputTokens:Number(
      usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
    ),
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
  if(request.maxOutputTokens!=null) body.max_tokens=Number(request.maxOutputTokens);
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
  if(!response?.ok) throw errorForStatus(Number(response?.status||500));
  let data;
  try{data=await response.json();}
  catch(error){throw invalidResponse(error);}
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string' || !text.length) throw invalidResponse();
  return {
    text,
    provider:'openai_compatible',
    preset:String(request.connection?.preset||'custom'),
    model:String(data.model||model),
    usage:usageOf(data),
    latencyMs:Math.max(0,Date.now()-started),
    providerRequestId:data.id||response.headers?.get?.('x-request-id')||null
  };
}
