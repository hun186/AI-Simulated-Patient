import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser } from '../lib/server-auth.js';
import { createInterviewSession } from '../lib/server-sessions.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Server persistence disabled'});
  const user=await requireUser(req,res,['student','teacher']);
  if(!user) return;
  const {caseId,mode='training',coachEnabled=false}=req.body??{};
  try{
    const session=await createInterviewSession({user,caseId,mode,coachEnabled});
    return res.status(201).json({session});
  }catch(error){
    if(error.message==='CASE_NOT_FOUND') return res.status(404).json({error:'Case not found'});
    throw error;
  }
}
