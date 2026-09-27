import { mockEvaluate } from '../lib/mock-evaluator.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,getTranscript,completeSession } from '../lib/server-sessions.js';
import { runEvaluatorAgent,repairEvaluatorAgent } from '../lib/llm/agents.js';
import { recordLlmUsage } from '../lib/llm/usage.js';
import { enforceLlmQuota } from '../lib/llm/quota.js';
import { getProviderSessionState,setProviderSessionState } from '../lib/llm/provider-state.js';
import { isProductionEnv } from '../lib/request-security.js';
import { buildEvaluationFailureDiagnostic,projectEvaluationFailureDiagnostic } from '../lib/evaluation-diagnostics.js';
import { saveEvaluationFailureDiagnostic } from '../lib/evaluation-diagnostic-store.js';

function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){try{return JSON.parse(value);}catch{return fallback;}}
  return value&&typeof value==='object'?value:fallback;
}
function providerFailure(res,error){
  if(error?.code==='AI_USAGE_QUOTA_EXCEEDED'){
    res.status(429).json({error:error.code,dimension:error.dimension});
    return true;
  }
  if(error?.code==='AI_PROVIDER_NOT_CONFIGURED'){
    res.status(503).json({error:'AI_EVALUATOR_PROVIDER_NOT_CONFIGURED'});
    return true;
  }
  if(error?.code==='dify_conversation_state_missing'){
    res.status(409).json({error:'DIFY_CONVERSATION_STATE_MISSING'});
    return true;
  }
  if(error?.code==='timeout'){
    res.status(504).json({error:'AI_PROVIDER_TIMEOUT'});
    return true;
  }
  if(error?.code){
    res.status(502).json({error:'AI_PROVIDER_FAILURE',code:error.code});
    return true;
  }
  return false;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],mode='exam',sessionId=null}=req.body??{};
  try{
    if(!isDatabaseEnabled()) return res.status(200).json(mockEvaluate({caseId,caseDefinition,transcript,revealedFactIds,mode}));
    const user=await requireUser(req,res,['student','teacher','admin']);
    if(!user) return;
    if(!(await requireCsrf(req,res))) return;
    const session=await getOwnedSession(sessionId,user);
    if(!session) return res.status(404).json({error:'Session not found'});
    if(session.status!=='active') return res.status(409).json({error:'Session already finalized'});
    const serverTranscript=await getTranscript(sessionId);
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:parseJson(session.revealed_fact_ids,[]);
    const caseSnapshot=parseJson(session.case_snapshot,{});
    const routes=parseJson(session.llm_route_snapshot,{});
    const route=routes.evaluator||null;
    const providerState=route?.connectionId
      ?await getProviderSessionState({sessionId,connectionId:route.connectionId})
      :{};
    const persistProviderState=async providerResult=>{
      if(providerResult?.providerState&&route?.connectionId){
        await setProviderSessionState({
          sessionId,connectionId:route.connectionId,
          providerKind:providerResult.provider,state:providerResult.providerState
        });
      }
    };

    if(!isProductionEnv() && route?.preset==='mock'){
      const result=mockEvaluate({
        caseId:session.case_id,caseDefinition:caseSnapshot,transcript:serverTranscript,
        revealedFactIds:revealed,mode:session.mode
      });
      await completeSession(sessionId,result);
      return res.status(200).json(result);
    }

    try{await enforceLlmQuota({userId:user.id});}catch(error){if(providerFailure(res,error)) return;throw error;}
    const recordAttempt=async({started,result=null,error=null})=>{
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'evaluator',route,result,error,
        latencyMs:Date.now()-started,occurredAt:new Date(started).toISOString()
      });
    };

    const started=Date.now();
    try{
      const result=await runEvaluatorAgent({session,transcript:serverTranscript,route,providerState});
      await persistProviderState(result);
      await recordAttempt({started,result});
      await completeSession(sessionId,result.evaluation);
      return res.status(200).json(result.evaluation);
    }catch(error){
      if(error?.llmResult)await persistProviderState(error.llmResult);
      await recordAttempt({started,error});

      if(error?.code==='INVALID_EVALUATION_CONTRACT' && error?.llmResult){
        try{await enforceLlmQuota({userId:user.id});}
        catch(quotaError){if(providerFailure(res,quotaError)) return;throw quotaError;}

        const repairStarted=Date.now();
        try{
          const refreshedProviderState=route?.connectionId
            ?await getProviderSessionState({sessionId,connectionId:route.connectionId})
            :providerState;
          const repaired=await repairEvaluatorAgent({
            session,transcript:serverTranscript,route,providerState:refreshedProviderState,
            invalidOutput:error.llmResult.text,validationError:error
          });
          await persistProviderState(repaired);
          await recordAttempt({started:repairStarted,result:repaired});
          await completeSession(sessionId,repaired.evaluation);
          return res.status(200).json(repaired.evaluation);
        }catch(repairError){
          if(repairError?.llmResult)await persistProviderState(repairError.llmResult);
          await recordAttempt({started:repairStarted,error:repairError});
          if(repairError?.code==='EVALUATION_REPAIR_FAILED' && repairError?.llmResult){
            const diagnostic=buildEvaluationFailureDiagnostic({
              session,user,route,initialError:error,repairError
            });
            try{
              diagnostic.storage={persisted:true};
              await saveEvaluationFailureDiagnostic({
                diagnostic,sessionId:session.id,studentUserId:session.student_user_id
              });
            }catch(storeError){
              diagnostic.storage={persisted:false};
              console.warn('evaluation_diagnostic_store_failed',diagnostic.errorId,storeError?.message||storeError);
            }
            return res.status(502).json({
              error:'AI_PROVIDER_FAILURE',
              code:'EVALUATION_REPAIR_FAILED',
              diagnostic:projectEvaluationFailureDiagnostic(diagnostic,{role:user.role})
            });
          }
          const mappedRepair=providerFailure(res,repairError);
          if(mappedRepair) return mappedRepair;
          throw repairError;
        }
      }

      const mapped=providerFailure(res,error);
      if(mapped) return mapped;
      throw error;
    }
  }catch(error){
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
