import { databaseDriver,isDatabaseEnabled,query,databaseInfo } from '../lib/db.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const driver=databaseDriver();
  if(!isDatabaseEnabled()) return res.status(200).json({ok:true,mode:'demo',database:'disabled',driver});
  try{
    const rows=await query('select 1 as ok');
    const info=await databaseInfo();
    return res.status(200).json({
      ok:Number(rows[0]?.ok)===1,
      mode:'production',
      database:'connected',
      driver:info.driver,
      schemaVersion:info.schemaVersion||null,
      wal:Boolean(info.wal)
    });
  }catch(error){
    console.error(error);
    return res.status(503).json({ok:false,mode:'production',database:'unavailable',driver});
  }
}
