import { getPublicCases } from '../lib/cases.js';
import { isDatabaseEnabled } from '../lib/db.js';
import { requireUser } from '../lib/server-auth.js';
import { listStudentCases } from '../lib/server-cases.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(200).json({mode:'demo',cases:getPublicCases()});
  const user=await requireUser(req,res,['student','teacher','admin']);
  if(!user) return;
  return res.status(200).json({mode:'production',cases:await listStudentCases()});
}
