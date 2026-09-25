import { mockCoach } from '../lib/mock-coach.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser } from '../lib/server-auth.js';
import { getCaseDefinition } from '../lib/server-cases.js';
import { getOwnedSession,getTranscript } from '../lib/server-sessions.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const {caseId='aphasia_001',caseDefinition=null,transcript=[],revealedFactIds=[],sessionId=null}=req.body??{};
  try{
    if(!isDatabaseEnabled()) return res.status(200).json(mockCoach({caseId,caseDefinition,transcript,revealedFactIds}));
    const user=await requireUser(req,res,['student','teacher']);
    if(!user) return;
    const session=await getOwnedSession(sessionId,user);
    if(!session || session.status!=='active') return res.status(404).json({error:'Active session not found'});
    if(session.mode!=='training' || !session.coach_enabled) return res.status(403).json({error:'Coach is disabled for this session'});
    const found=await getCaseDefinition(session.case_id);
    const serverTranscript=await getTranscript(sessionId);
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:[];
    return res.status(200).json(mockCoach({caseId:session.case_id,caseDefinition:found.definition,transcript:serverTranscript,revealedFactIds:revealed}));
  }catch(error){
    console.error(error); return res.status(500).json({error:'Unexpected error'});
  }
}
