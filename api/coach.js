import { mockCoach } from '../lib/mock-coach.js';
import { assessCriterion,questionQuality,studentTurns } from '../lib/assessment-utils.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,getTranscript } from '../lib/server-sessions.js';
import { runCoachAgent } from '../lib/llm/agents.js';
import { recordLlmUsage } from '../lib/llm/usage.js';
import { enforceLlmQuota } from '../lib/llm/quota.js';
import { isProductionEnv } from '../lib/request-security.js';

function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){try{return JSON.parse(value);}catch{return fallback;}}
  return value&&typeof value==='object'?value:fallback;
}
function coachShape(caseData,transcript,guidance){
  const items=(caseData.rubric||[]).map(criterion=>assessCriterion({
    criterion,caseData,transcript,revealedFactIds:[]
  }));
  const turns=studentTurns(transcript);
  const last=turns.at(-1);
  return {
    progress:{
      covered:items.filter(item=>item.status==='covered').length,
      partial:items.filter(item=>item.status==='partial').length,
      total:items.length
    },
    lastQuestion:last?{text:last.content,...questionQuality(last.content)}:null,
    nextHint:guidance,
    reflectionPrompt:'在送出下一題前，先確認這題要釐清的臨床面向，以及它是否承接病人的上一個回答。'
  };
}
function providerFailure(res,error){
  if(error?.code==='AI_USAGE_QUOTA_EXCEEDED'){
    res.status(429).json({error:error.code,dimension:error.dimension});
    return true;
  }
  if(error?.code==='AI_PROVIDER_NOT_CONFIGURED'){
    res.status(503).json({error:'AI_COACH_PROVIDER_NOT_CONFIGURED'});
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
  const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],sessionId=null}=req.body??{};
  try{
    if(!isDatabaseEnabled()) return res.status(200).json(mockCoach({caseId,caseDefinition,transcript,revealedFactIds}));
    const user=await requireUser(req,res,['student','teacher','admin']);
    if(!user) return;
    if(!(await requireCsrf(req,res))) return;
    const session=await getOwnedSession(sessionId,user);
    if(!session || session.status!=='active') return res.status(404).json({error:'Active session not found'});
    if(session.mode!=='training' || !session.coach_enabled) return res.status(403).json({error:'Coach is disabled for this session'});
    const serverTranscript=await getTranscript(sessionId);
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:parseJson(session.revealed_fact_ids,[]);
    const caseSnapshot=parseJson(session.case_snapshot,{});
    const routes=parseJson(session.llm_route_snapshot,{});
    const route=routes.coach||null;

    if(!isProductionEnv() && route?.preset==='mock'){
      return res.status(200).json(mockCoach({
        caseId:session.case_id,caseDefinition:caseSnapshot,transcript:serverTranscript,revealedFactIds:revealed
      }));
    }

    try{await enforceLlmQuota({userId:user.id});}catch(error){if(providerFailure(res,error)) return;throw error;}
    const started=Date.now();
    try{
      const result=await runCoachAgent({session,transcript:serverTranscript,route});
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'coach',route,result
      });
      return res.status(200).json({
        provider:result.preset,model:result.model,...coachShape(caseSnapshot,serverTranscript,result.guidance)
      });
    }catch(error){
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'coach',route,error,
        latencyMs:Date.now()-started
      });
      const mapped=providerFailure(res,error);
      if(mapped) return mapped;
      throw error;
    }
  }catch(error){
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
