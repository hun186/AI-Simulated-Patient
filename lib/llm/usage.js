import { query } from '../db.js';

function safeInt(value){
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?Math.round(number):0;
}

export async function recordLlmUsage({
  userId,sessionId,caseId,agentType,route,result=null,error=null,latencyMs=null
}){
  const providerResult=error?.llmResult||result||null;
  const usage=providerResult?.usage||{};
  const usageStatus=String(providerResult?.usageStatus||'unreported');
  await query(
    `insert into llm_usage_events
      (user_id,session_id,case_id,agent_type,connection_id,provider_kind,preset,model,
       input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
       latency_ms,success,error_code,provider_request_id,usage_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      userId||null,sessionId||null,caseId||null,agentType,route?.connectionId||null,
      route?.providerKind||providerResult?.provider||'unknown',
      route?.preset||providerResult?.preset||'unknown',
      providerResult?.model||route?.model||'unknown',
      safeInt(usage.inputTokens),safeInt(usage.cachedInputTokens),safeInt(usage.outputTokens),
      safeInt(usage.reasoningTokens),safeInt(usage.totalTokens),
      safeInt(providerResult?.latencyMs??latencyMs),
      !error,error?.code||null,providerResult?.providerRequestId||null,
      ['reported','unreported','estimated'].includes(usageStatus)?usageStatus:'unreported'
    ]
  );
}
