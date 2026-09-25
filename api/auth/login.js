import { isDatabaseEnabled } from '../../lib/db.js';
import { loginUser,setSessionCookie,AuthRateLimitError } from '../../lib/server-auth.js';
import { requireTrustedOrigin } from '../../lib/request-security.js';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  if(!requireTrustedOrigin(req,res)) return;
  const {email='',password=''}=req.body??{};
  try{
    const auth=await loginUser({email,password,req});
    if(!auth) return res.status(401).json({error:'帳號或密碼錯誤，或帳號尚未啟用。'});
    setSessionCookie(res,auth.token,auth.maxAge);
    return res.status(200).json({user:auth.user,csrfToken:auth.csrfToken});
  }catch(error){
    if(error instanceof AuthRateLimitError){
      res.setHeader('Retry-After',String(error.retryAfter));
      return res.status(429).json({error:`登入嘗試過多，請稍後再試（約 ${error.retryAfter} 秒）。`});
    }
    throw error;
  }
}
