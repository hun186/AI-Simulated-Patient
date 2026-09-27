import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';
import { getEvaluationFailureDiagnosticForActor } from '../../lib/evaluation-diagnostic-store.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor)return;
  const errorId=String(req.query?.errorId||'').trim();
  if(!errorId)return res.status(400).json({error:'errorId is required'});
  const found=await getEvaluationFailureDiagnosticForActor(errorId,actor);
  if(!found)return res.status(404).json({error:'Evaluation diagnostic not found'});
  return res.status(200).json({
    errorId:found.errorId,
    sessionId:found.sessionId,
    studentUserId:found.studentUserId,
    createdAt:found.createdAt,
    diagnostic:found.diagnostic
  });
}
