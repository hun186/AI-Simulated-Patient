import { generateOpenAI } from './providers/openai.js';
import { generateOpenAICompatible } from './providers/openai-compatible.js';
import { LlmProviderError } from './errors.js';

export async function generateLlm(request,options={}){
  const kind=request?.connection?.providerKind;
  const preset=request?.connection?.preset;
  if(kind==='openai' && preset==='openai') return generateOpenAI(request,options);
  if(kind==='openai_compatible' && ['deepseek','ollama','custom'].includes(preset)){
    return generateOpenAICompatible(request,options);
  }
  throw new LlmProviderError('invalid_response');
}

export async function testLlmConnection(connection,{fetchImpl=fetch}={}){
  try{
    const isDeepSeek=connection?.preset==='deepseek';
    const result=await generateLlm({
      connection,
      model:connection.defaultModel,
      systemPrompt:'Connection test. Reply with OK.',
      messages:[{role:'user',content:'OK'}],
      maxOutputTokens:isDeepSeek?32:8,
      temperature:0,
      thinkingMode:isDeepSeek?'disabled':null,
      timeoutMs:10000
    },{fetchImpl});
    return {
      ok:true,
      provider:result.provider,
      preset:result.preset,
      model:result.model,
      latencyMs:result.latencyMs
    };
  }catch(error){
    return {
      ok:false,
      errorCode:error?.code||'invalid_response'
    };
  }
}
