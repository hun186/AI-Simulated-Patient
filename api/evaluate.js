import { mockEvaluate } from '../lib/mock-evaluator.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,getTranscript,completeSession } from '../lib/server-sessions.js';

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
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:[];
    const caseSnapshot=typeof session.case_snapshot==='string'?JSON.parse(session.case_snapshot):session.case_snapshot;
    const result=mockEvaluate({caseId:session.case_id,caseDefinition:caseSnapshot,transcript:serverTranscript,revealedFactIds:revealed,mode:session.mode});
    await completeSession(sessionId,result);
    return res.status(200).json(result);
  }catch(error){
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
