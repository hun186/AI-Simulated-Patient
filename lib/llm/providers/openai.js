import { errorForStatus,invalidResponse,normalizeFetchError } from '../errors.js';

const OPENAI_RESPONSES_URL='https://api.openai.com/v1/responses';

function modelFor(request){
  return String(request.model||request.connection?.defaultModel||'').trim();
}

function extractText(data){
  if(typeof data?.output_text==='string' && data.output_text.length) return data.output_text;
  const pieces=[];
  for(const item of data?.output||[]){
    if(item?.type!=='message') continue;
    for(const content of item.content||[]){
      if(content?.type==='output_text' && typeof content.text==='string') pieces.push(content.text);
    }
  }
  return pieces.join('');
}

function usageOf(data){
  const usage=data?.usage||{};
  return {
    inputTokens:Number(usage.input_tokens||0),
    cachedInputTokens:Number(usage.input_tokens_details?.cached_tokens||0),
    outputTokens:Number(usage.output_tokens||0),
    reasoningTokens:Number(usage.output_tokens_details?.reasoning_tokens||0),
    totalTokens:Number(usage.total_tokens||0)
  };
}

export async function generateOpenAI(request,{fetchImpl=fetch}={}){
  const model=modelFor(request);
  if(!model) throw invalidResponse();
  const body={
    model,
    input:(request.messages||[]).map(({role,content})=>({role,content:String(content??'')}))
  };
  if(request.systemPrompt) body.instructions=String(request.systemPrompt);
  if(request.maxOutputTokens!=null) body.max_output_tokens=Number(request.maxOutputTokens);
  if(request.temperature!=null) body.temperature=Number(request.temperature);
  if(request.safetyIdentifier) body.safety_identifier=String(request.safetyIdentifier);
  if(request.responseFormat) body.text={format:request.responseFormat};

  const controller=new AbortController();
  const timeoutMs=Math.max(1,Number(request.timeoutMs||30000));
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const started=Date.now();
  let response;
  try{
    response=await fetchImpl(OPENAI_RESPONSES_URL,{
      method:'POST',
      headers:{
        'content-type':'application/json',
        Authorization:'Bearer '+String(request.connection?.apiKey||'')
      },
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
  const text=extractText(data);
  if(!text) throw invalidResponse();
  return {
    text,
    provider:'openai',
    preset:'openai',
    model:String(data.model||model),
    usage:usageOf(data),
    latencyMs:Math.max(0,Date.now()-started),
    providerRequestId:data.id||response.headers?.get?.('x-request-id')||null
  };
}
