import { isDatabaseEnabled } from '../../lib/db.js';
import { getRequestUser } from '../../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(200).json({mode:'demo',user:null});
  const user=await getRequestUser(req);
  return res.status(user?200:401).json({mode:'production',user});
}
