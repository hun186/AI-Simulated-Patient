import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser } from '../lib/server-auth.js';
import { createInterviewSession,updateCoachEnabled } from '../lib/server-sessions.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Server persistence disabled'});
  const user=await requireUser(req,res,['student','teacher']);
  if(!user) return;
  const {action='create',caseId,mode='training',coachEnabled=false,sessionId=null}=req.body??{};
  try{
    if(action==='setCoach'){
      if(!sessionId) return res.status(400).json({error:'sessionId is required'});
      const updated=await updateCoachEnabled(sessionId,user,coachEnabled);
      if(!updated) return res.status(404).json({error:'Active training session not found'});
      return res.status(200).json({session:{id:updated.id,coachEnabled:updated.coach_enabled}});
    }
    const session=await createInterviewSession({user,caseId,mode,coachEnabled});
    return res.status(201).json({session});
  }catch(error){
    if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
    throw error;
  }
}
