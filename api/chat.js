import { mockPatientReply } from '../lib/mock-patient.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser,requireCsrf } from '../lib/server-auth.js';
import { getOwnedSession,appendMessage,setRevealedFacts } from '../lib/server-sessions.js';

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
    const revealed=Array.isArray(session.revealed_fact_ids)?session.revealed_fact_ids:[];
    const caseSnapshot=typeof session.case_snapshot==='string'?JSON.parse(session.case_snapshot):session.case_snapshot;
    const result=mockPatientReply({caseId:session.case_id,caseDefinition:caseSnapshot,message,revealedFactIds:revealed});
    await appendMessage(sessionId,'student',message);
    await appendMessage(sessionId,'patient',result.reply);
    await setRevealedFacts(sessionId,result.revealedFactIds);
    return res.status(200).json({reply:result.reply,provider:result.provider});
  }catch(error){
    if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
    console.error(error);return res.status(500).json({error:'Unexpected error'});
  }
}
