import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase,databaseDriver,databaseInfo } from '../lib/db.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
if(databaseDriver()!=='sqlite'){
  throw new Error('db:backup currently supports SQLite mode only.');
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const dir=resolve(root,'data','backups');
mkdirSync(dir,{recursive:true});
const destination=resolve(dir,`aisp-${stamp}.sqlite`);
await backupDatabase(destination);
const info=await databaseInfo();
console.log(`SQLite backup created: ${destination}`);
console.log(`Source: ${info.path}`);
