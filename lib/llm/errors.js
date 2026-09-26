const PUBLIC_MESSAGES={
  authentication_failed:'LLM provider authentication failed',
  endpoint_unreachable:'LLM provider is unavailable',
  model_not_found:'LLM model was not found',
  rate_limited:'LLM provider rate limit reached',
  invalid_response:'LLM provider returned an invalid response',
  timeout:'LLM provider request timed out'
};

export class LlmProviderError extends Error{
  constructor(code,{status=null,cause=null}={}){
    super(PUBLIC_MESSAGES[code]||'LLM provider request failed',{cause});
    this.name='LlmProviderError';
    this.code=code;
    this.status=status;
  }
}

export function errorForStatus(status){
  if(status===401||status===403) return new LlmProviderError('authentication_failed',{status});
  if(status===404) return new LlmProviderError('model_not_found',{status});
  if(status===429) return new LlmProviderError('rate_limited',{status});
  if(status>=500) return new LlmProviderError('endpoint_unreachable',{status});
  return new LlmProviderError('invalid_response',{status});
}

export function normalizeFetchError(error){
  if(error instanceof LlmProviderError) return error;
  if(error?.name==='AbortError') return new LlmProviderError('timeout',{cause:error});
  return new LlmProviderError('endpoint_unreachable',{cause:error});
}

export function invalidResponse(cause=null){
  return new LlmProviderError('invalid_response',{cause});
}
