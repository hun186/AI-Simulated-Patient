import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';
import { getEvaluationAuditForActor } from '../../lib/evaluation-audit-store.js';
import { projectEvaluationAudit } from '../../lib/evaluation-audit.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled())return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor)return;
  const evaluationId=String(req.query?.evaluationId||'').trim();
  if(!evaluationId)return res.status(400).json({error:'evaluationId is required'});
  const found=await getEvaluationAuditForActor(evaluationId,actor);
  if(!found)return res.status(404).json({error:'Evaluation audit not found or expired'});
  return res.status(200).json({
    evaluationId:found.evaluationId,
    sessionId:found.sessionId,
    studentUserId:found.studentUserId,
    status:found.status,
    createdAt:found.createdAt,
    expiresAt:found.expiresAt,
    audit:projectEvaluationAudit(found.audit,{role:actor.role})
  });
}
