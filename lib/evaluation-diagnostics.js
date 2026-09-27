import { randomBytes } from 'node:crypto';

const MAX_RESPONSE_CHARS=60000;
const REDACTED='[REDACTED]';

function textValue(value){
  return value==null?'':String(value);
}

function truncate(value,max=MAX_RESPONSE_CHARS){
  const source=textValue(value);
  if(source.length<=max) return {text:source,truncated:false,originalChars:source.length};
  return {text:source.slice(0,max)+'\n...[truncated]...',truncated:true,originalChars:source.length};
}

export function redactDiagnosticText(value){
  let text=textValue(value);
  text=text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/=:-]{8,}/gi,'$1'+REDACTED);
  text=text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,REDACTED);
  text=text.replace(/((?:"|')?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)(?:"|')?\s*[:=]\s*(?:"|'))([^"']+)((?:"|'))/gi,'$1'+REDACTED+'$3');
  text=text.replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b\s*[:=]\s*)([^\s,;]+)/gi,'$1'+REDACTED);
  return text;
}

function safeUsage(result){
  const usage=result?.usage&&typeof result.usage==='object'?result.usage:{};
  return {
    inputTokens:Number(usage.inputTokens||0),
    cachedInputTokens:Number(usage.cachedInputTokens||0),
    outputTokens:Number(usage.outputTokens||0),
    reasoningTokens:Number(usage.reasoningTokens||0),
    totalTokens:Number(usage.totalTokens||0)
  };
}

function safeAttempt(stage,result,error){
  const clipped=truncate(redactDiagnosticText(result?.text??''));
  return {
    stage,
    provider:result?.provider||null,
    preset:result?.preset||null,
    model:result?.model||null,
    providerRequestId:result?.providerRequestId||null,
    latencyMs:Number.isFinite(Number(result?.latencyMs))?Number(result.latencyMs):null,
    usageStatus:result?.usageStatus||null,
    usage:safeUsage(result),
    responseText:clipped.text,
    responseTruncated:clipped.truncated,
    responseOriginalChars:clipped.originalChars,
    validation:{
      code:error?.code||null,
      message:redactDiagnosticText(error?.message||'')
    }
  };
}

function objectValue(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  if(typeof value==='string'){
    try{
      const parsed=JSON.parse(value);
      return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
    }catch{return {};}
  }
  return {};
}

function safeEvaluatorRoute(route){
  const raw=route?.config;
  let config={};
  if(raw&&typeof raw==='object') config=raw;
  else if(typeof raw==='string'){
    try{config=JSON.parse(raw);}catch{config={};}
  }
  return {
    connectionId:route?.connectionId||null,
    preset:route?.preset||null,
    model:route?.model||null,
    difyExecutionMode:config.difyExecutionMode||null,
    difyFinalTriggerEnabled:Boolean(config.difyFinalTriggerEnabled)
  };
}

function errorId(now=new Date()){
  const day=now.toISOString().slice(0,10).replaceAll('-','');
  return 'EVL-'+day+'-'+randomBytes(4).toString('hex').toUpperCase();
}

export function buildEvaluationFailureDiagnostic({
  session,user,route,initialError,repairError,now=new Date()
}={}){
  const id=errorId(now);
  return {
    schemaVersion:1,
    errorId:id,
    category:'evaluation_contract_repair_failed',
    occurredAt:now.toISOString(),
    downloadFilename:'evaluation-debug-'+id+'.json',
    session:{
      id:session?.id||null,
      caseId:session?.case_id??session?.caseId??null,
      caseLabel:objectValue(session?.case_snapshot??session?.caseSnapshot).studentLabel||null,
      mode:session?.mode||null,
      userRole:user?.role||null
    },
    runtime:{
      environment:process.env.APP_ENV||process.env.NODE_ENV||'development',
      commitSha:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GIT_COMMIT_SHA||null,
      nodeVersion:process.version
    },
    evaluatorRoute:safeEvaluatorRoute(route),
    attempts:{
      initial:safeAttempt('initial_evaluation',initialError?.llmResult,initialError),
      repair:safeAttempt('automatic_repair',repairError?.llmResult,repairError)
    },
    security:{
      redactionApplied:true,
      excludedFields:['apiKey','authorization','cookie','password','provider connection baseUrl','prompt template','transcript']
    }
  };
}


export function projectEvaluationFailureDiagnostic(diagnostic,{role}={}){
  const projected=JSON.parse(JSON.stringify(diagnostic||{}));
  const includeResponses=role==='admin'||role==='teacher';
  projected.access={
    rawResponsesIncluded:includeResponses,
    staffLookupPath:projected?.storage?.persisted&&projected.errorId
      ?'/api/teacher/evaluation-diagnostics?errorId='+encodeURIComponent(projected.errorId)
      :null
  };
  if(!includeResponses){
    if(projected.evaluatorRoute) delete projected.evaluatorRoute.connectionId;
    for(const attempt of Object.values(projected.attempts||{})){
      attempt.responseText='';
      attempt.responseRestricted=true;
    }
  }
  return projected;
}
