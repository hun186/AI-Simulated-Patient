import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser,requireCsrf,changePassword,clearSessionCookie } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;
  if(!(await requireCsrf(req,res))) return;
  const {currentPassword='',newPassword=''}=req.body??{};
  try{
    const ok=await changePassword({user,currentPassword,newPassword,req});
    if(!ok) return res.status(400).json({error:'目前密碼不正確。'});
    clearSessionCookie(res);
    return res.status(204).end();
  }catch(error){
    if(String(error.message).includes('密碼')) return res.status(400).json({error:error.message});
    throw error;
  }
}
