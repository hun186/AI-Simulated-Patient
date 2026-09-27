import { randomBytes } from 'node:crypto';
import { redactDiagnosticText } from './evaluation-diagnostics.js';

const MAX_RESPONSE_CHARS=60000;
const DEFAULT_RETENTION_DAYS=90;

function textValue(value){return value==null?'':String(value);}
function truncate(value,max=MAX_RESPONSE_CHARS){
  const source=textValue(value);
  if(source.length<=max)return {text:source,truncated:false,originalChars:source.length};
  return {text:source.slice(0,max)+'\n...[truncated]...',truncated:true,originalChars:source.length};
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
  if(!result&&!error)return null;
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
  if(raw&&typeof raw==='object')config=raw;
  else if(typeof raw==='string'){try{config=JSON.parse(raw);}catch{config={};}}
  return {
    connectionId:route?.connectionId||null,
    preset:route?.preset||null,
    model:route?.model||null,
    difyExecutionMode:config.difyExecutionMode||null,
    difyFinalTriggerEnabled:Boolean(config.difyFinalTriggerEnabled)
  };
}
function evaluationId(now){
  const day=now.toISOString().slice(0,10).replaceAll('-','');
  return 'EVL-'+day+'-'+randomBytes(4).toString('hex').toUpperCase();
}
function retentionDays(){
  const value=Number(process.env.EVALUATION_AUDIT_RETENTION_DAYS||DEFAULT_RETENTION_DAYS);
  return Number.isFinite(value)?Math.min(3650,Math.max(1,Math.round(value))):DEFAULT_RETENTION_DAYS;
}
function addDays(date,days){
  return new Date(date.getTime()+days*24*60*60*1000);
}
function safeJsonValue(value){
  if(value==null)return value;
  if(typeof value==='string')return redactDiagnosticText(value);
  if(Array.isArray(value))return value.map(safeJsonValue);
  if(typeof value==='object'){
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,safeJsonValue(item)]));
  }
  return value;
}
function normalizeTrace(trace){
  if(!trace||typeof trace!=='object')return {applied:false,actions:[]};
  return {
    applied:Boolean(trace.applied),
    actions:Array.isArray(trace.actions)?safeJsonValue(trace.actions):[]
  };
}

export function buildEvaluationAudit({
  session,user,route,status,
  initialResult=null,initialError=null,
  repairResult=null,repairError=null,
  canonicalEvaluation=null,
  now=new Date()
}={}){
  const id=evaluationId(now);
  const days=retentionDays();
  const initialNormalization=normalizeTrace(initialResult?.normalization||initialError?.evaluationNormalization);
  const repairNormalization=normalizeTrace(repairResult?.normalization||repairError?.evaluationNormalization);
  const normalized=initialNormalization.applied||repairNormalization.applied;
  const repairUsed=Boolean(repairResult||repairError);
  return {
    schemaVersion:1,
    evaluationId:id,
    errorId:status==='failed'?id:null,
    category:status==='failed'?'evaluation_contract_repair_failed':'evaluation_audit',
    status,
    occurredAt:now.toISOString(),
    retentionDays:days,
    expiresAt:addDays(now,days).toISOString(),
    downloadFilename:'evaluation-audit-'+id+'.zip',
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
      initial:safeAttempt('initial_evaluation',initialResult||initialError?.llmResult,initialError),
      repair:safeAttempt('automatic_repair',repairResult||repairError?.llmResult,repairError)
    },
    normalization:{
      applied:normalized,
      initial:initialNormalization,
      repair:repairNormalization
    },
    repairUsed,
    canonicalEvaluation:canonicalEvaluation?safeJsonValue(canonicalEvaluation):null,
    security:{
      redactionApplied:true,
      staffOnlyRawResponses:true,
      excludedFields:['apiKey','authorization','cookie','password','provider connection baseUrl','prompt template','full transcript'],
      note:'Evaluator responses may contain quoted transcript evidence; raw responses and canonical evaluation are restricted to authorized staff.'
    }
  };
}

export function projectEvaluationAudit(audit,{role}={}){
  const projected=JSON.parse(JSON.stringify(audit||{}));
  const includeRestricted=role==='admin'||role==='teacher';
  projected.access={
    rawResponsesIncluded:includeRestricted,
    canonicalEvaluationIncluded:includeRestricted,
    staffLookupPath:projected?.storage?.persisted&&projected.evaluationId
      ?'/api/teacher/evaluation-audits?evaluationId='+encodeURIComponent(projected.evaluationId)
      :null
  };
  if(!includeRestricted){
    if(projected.evaluatorRoute)delete projected.evaluatorRoute.connectionId;
    for(const attempt of Object.values(projected.attempts||{})){
      if(!attempt)continue;
      attempt.responseText='';
      attempt.responseRestricted=true;
    }
    projected.canonicalEvaluation=null;
  }
  return projected;
}

export function evaluationAuditSummary(audit){
  if(!audit)return null;
  const actions=[
    ...(audit.normalization?.initial?.actions||[]),
    ...(audit.normalization?.repair?.actions||[])
  ];
  return {
    evaluationId:audit.evaluationId,
    status:audit.status,
    occurredAt:audit.occurredAt,
    expiresAt:audit.expiresAt,
    normalizationApplied:Boolean(audit.normalization?.applied),
    normalizationCount:actions.length,
    normalizationTypes:[...new Set(actions.map(item=>item?.type).filter(Boolean))],
    repairUsed:Boolean(audit.repairUsed),
    provider:audit.attempts?.repair?.provider||audit.attempts?.initial?.provider||audit.evaluatorRoute?.preset||null,
    model:audit.attempts?.repair?.model||audit.attempts?.initial?.model||audit.evaluatorRoute?.model||null
  };
}
