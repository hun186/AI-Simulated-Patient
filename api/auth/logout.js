import { isDatabaseEnabled } from '../../lib/db.js';
import { logoutRequest,clearSessionCookie,requireCsrf } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(isDatabaseEnabled()){
    if(!(await requireCsrf(req,res))) return;
    await logoutRequest(req);
  }
  clearSessionCookie(res);
  return res.status(204).end();
}
