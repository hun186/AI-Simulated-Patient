import { isDatabaseEnabled } from '../../lib/db.js';
import { getRequestUser,rotateCsrfToken } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(200).json({mode:'demo',user:null,csrfToken:null});
  const user=await getRequestUser(req);
  if(!user) return res.status(401).json({mode:'production',user:null});
  const csrfToken=await rotateCsrfToken(req);
  return res.status(200).json({mode:'production',user,csrfToken});
}
