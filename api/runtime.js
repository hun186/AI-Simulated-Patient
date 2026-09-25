import { isDatabaseEnabled } from '../lib/db.js';

export default function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  return res.status(200).json({
    persistence:isDatabaseEnabled()?'postgres':'browser',
    auth:isDatabaseEnabled(),
    llmProvider:process.env.LLM_PROVIDER||'mock'
  });
}
