import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';

function migrationFiles(projectRoot){
  const directory=join(projectRoot,'db','migrations');
  return readdirSync(directory)
    .map(name=>{
      const match=/^(\d+)_.*\.sql$/.exec(name);
      return match?{name,version:Number(match[1])}:null;
    })
    .filter(Boolean)
    .sort((a,b)=>a.version-b.version);
}

export function applySqliteMigrations(db,{projectRoot}){
  let current=Number(db.pragma('user_version',{simple:true})||0);
  const seen=new Set();
  for(const migration of migrationFiles(projectRoot)){
    if(seen.has(migration.version)) throw new Error('DUPLICATE_SQLITE_MIGRATION_VERSION_'+migration.version);
    seen.add(migration.version);
    if(migration.version<=current) continue;
    const sql=readFileSync(join(projectRoot,'db','migrations',migration.name),'utf8');
    db.transaction(()=>{
      db.exec(sql);
      db.pragma('user_version = '+migration.version);
    })();
    current=migration.version;
  }
  return current;
}
