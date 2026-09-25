import { isDatabaseEnabled } from '../../lib/db.js';
import { loginUser,setSessionCookie } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const {email='',password=''}=req.body??{};
  const auth=await loginUser({email,password});
  if(!auth) return res.status(401).json({error:'Invalid email or password'});
  setSessionCookie(res,auth.token);
  return res.status(200).json({user:auth.user});
}
