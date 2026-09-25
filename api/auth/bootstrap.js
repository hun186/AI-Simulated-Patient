import { isDatabaseEnabled } from '../../lib/db.js';
import { countUsers,createUser,loginUser,setSessionCookie } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const {setupKey,email,password,displayName='Teacher'}=req.body??{};
  if(!process.env.ADMIN_SETUP_KEY || setupKey!==process.env.ADMIN_SETUP_KEY) return res.status(403).json({error:'Invalid setup key'});
  if(await countUsers()) return res.status(409).json({error:'Bootstrap already completed'});
  if(!email || !password || password.length<10) return res.status(400).json({error:'Email and password (10+ chars) required'});
  await createUser({email,password,displayName,role:'teacher'});
  const auth=await loginUser({email,password});
  setSessionCookie(res,auth.token);
  return res.status(201).json({user:auth.user});
}
