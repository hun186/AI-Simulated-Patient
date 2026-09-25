import { databaseDriver,isDatabaseEnabled,databaseInfo } from '../lib/db.js';
import { countUsers,countAdmins } from '../lib/server-auth.js';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const database=isDatabaseEnabled();
  const driver=databaseDriver();
  const users=database?await countUsers():0;
  const admins=database?await countAdmins():0;
  const info=database?await databaseInfo():{driver};
  return res.status(200).json({
    persistence:driver,
    auth:database,
    database:{driver:info.driver,schemaVersion:info.schemaVersion||null,wal:Boolean(info.wal)},
    needsBootstrap:database&&users===0,
    needsAdminMigration:database&&users>0&&admins===0,
    llmProvider:process.env.LLM_PROVIDER||'mock'
  });
}
