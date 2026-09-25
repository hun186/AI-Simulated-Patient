import { isDatabaseEnabled } from '../../lib/db.js';
import { logoutRequest,clearSessionCookie } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(isDatabaseEnabled()) await logoutRequest(req);
  clearSessionCookie(res);
  return res.status(204).end();
}
