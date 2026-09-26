import { mockPatientReply } from '../lib/mock-patient.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,getTranscript,appendMessage,setRevealedFacts } from '../lib/server-sessions.js';
import { runPatientAgent } from '../lib/llm/agents.js';
import { recordLlmUsage } from '../lib/llm/usage.js';
import { enforceLlmQuota } from '../lib/llm/quota.js';
import { isProductionEnv } from '../lib/request-security.js';

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
    res.status(503).json({error:error.code});
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
  const {caseId='aphasia_001',caseDefinition=null,message='',revealedFactIds=[],sessionId=null}=req.body??{};
  if(!message.trim()) return res.status(400).json({error:'message is required'});
  try{
    if(!isDatabaseEnabled()) return res.status(200).json(mockPatientReply({caseId,caseDefinition,message,revealedFactIds}));
    const user=await requireUser(req,res,['student','teacher','admin']);
    if(!user) return;
    if(!(await requireCsrf(req,res))) return;
    if(!sessionId) return res.status(400).json({error:'sessionId is required'});
    const session=await getOwnedSession(sessionId,user);
    if(!session || session.status!=='active') return res.status(404).json({error:'Active session not found'});
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:parseJson(session.revealed_fact_ids,[]);
    const caseSnapshot=parseJson(session.case_snapshot,{});
    const routes=parseJson(session.llm_route_snapshot,{});
    const route=routes.patient||null;

    if(!isProductionEnv() && route?.preset==='mock'){
      const result=mockPatientReply({caseId:session.case_id,caseDefinition:caseSnapshot,message,revealedFactIds:revealed});
      await appendMessage(sessionId,'student',message);
      await appendMessage(sessionId,'patient',result.reply);
      await setRevealedFacts(sessionId,result.revealedFactIds);
      return res.status(200).json({reply:result.reply,provider:result.provider});
    }

    const transcript=await getTranscript(sessionId);
    try{await enforceLlmQuota({userId:user.id});}catch(error){if(providerFailure(res,error)) return;throw error;}
    const started=Date.now();
    try{
      const result=await runPatientAgent({session,message,transcript,route});
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'patient',route,result,
        occurredAt:new Date(started).toISOString()
      });
      await appendMessage(sessionId,'student',message);
      await appendMessage(sessionId,'patient',result.reply);
      return res.status(200).json({reply:result.reply,provider:result.preset,model:result.model});
    }catch(error){
      await recordLlmUsage({
        userId:user.id,sessionId,caseId:session.case_id,agentType:'patient',route,error,
        latencyMs:Date.now()-started,occurredAt:new Date(started).toISOString()
      });
      const mapped=providerFailure(res,error);
      if(mapped) return mapped;
      throw error;
    }
  }catch(error){
    if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
