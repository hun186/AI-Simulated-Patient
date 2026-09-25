import { isDatabaseEnabled,query } from '../lib/db.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(200).json({ok:true,mode:'demo',database:'disabled'});
  try{
    const rows=await query('select 1 as ok');
    return res.status(200).json({ok:rows[0]?.ok===1,mode:'production',database:'connected'});
  }catch(error){
    console.error(error);
    return res.status(503).json({ok:false,mode:'production',database:'unavailable'});
  }
}
