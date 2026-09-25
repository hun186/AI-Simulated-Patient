import { isDatabaseEnabled } from '../lib/db.js';
import { countUsers } from '../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const database=isDatabaseEnabled();
  const users=database?await countUsers():0;
  return res.status(200).json({
    persistence:database?'postgres':'browser',
    auth:database,
    needsBootstrap:database&&users===0,
    llmProvider:process.env.LLM_PROVIDER||'mock'
  });
}
