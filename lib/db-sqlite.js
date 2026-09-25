import Database from 'better-sqlite3';
import { mkdirSync,readFileSync } from 'node:fs';
import { dirname,isAbsolute,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=resolve(fileURLToPath(new URL('../',import.meta.url)));
let connection=null;
let openedPath=null;

function configuredPath(){
  const value=String(process.env.SQLITE_PATH||'').trim();
  if(value===':memory:') return value;
  if(!value) return resolve(projectRoot,'data','aisp.sqlite');
  return isAbsolute(value)?value:resolve(projectRoot,value);
}

function open(){
  if(connection) return connection;
  if(process.env.VERCEL) throw new Error('SQLite file persistence is not supported on Vercel. Use browser demo or PostgreSQL.');
  openedPath=configuredPath();
  if(openedPath!==':memory:') mkdirSync(dirname(openedPath),{recursive:true});
  const db=new Database(openedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('wal_autocheckpoint = 1000');
  const schemaPath=resolve(projectRoot,'db','sqlite-schema.sql');
  db.exec(readFileSync(schemaPath,'utf8'));
  connection=db;
  return connection;
}

function normaliseParam(value){
  if(value===undefined) return null;
  if(typeof value==='boolean') return value?1:0;
  if(value instanceof Date) return value.toISOString();
  return value;
}

function translate(text,params){
  let sql=String(text)
    .replace(/count\(\*\)::int/gi,'cast(count(*) as integer)')
    .replace(/::jsonb\b/gi,'')
    .replace(/::json\b/gi,'')
    .replace(/\bnow\(\)/gi,"strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const ordered=[];
  let found=false;
  sql=sql.replace(/\$(\d+)/g,(_,index)=>{
    found=true;
    ordered.push(normaliseParam(params[Number(index)-1]));
    return '?';
  });
  return {sql,params:found?ordered:params.map(normaliseParam)};
}

function mapError(error){
  const original=String(error?.code||'');
  if(original.startsWith('SQLITE_CONSTRAINT_UNIQUE') || /unique constraint failed/i.test(String(error?.message||''))){
    error.sqliteCode=original;
    try{error.code='23505';}catch{}
  }
  return error;
}

export async function querySqlite(text,params=[]){
  const db=open();
  const translated=translate(text,params);
  try{
    const statement=db.prepare(translated.sql);
    if(statement.reader) return statement.all(...translated.params);
    statement.run(...translated.params);
    return [];
  }catch(error){
    throw mapError(error);
  }
}

export function sqliteInfo(){
  open();
  return {driver:'sqlite',path:openedPath,wal:true,schemaVersion:Number(connection.pragma('user_version',{simple:true})||0)};
}

export async function backupSqlite(destination){
  const db=open();
  if(!destination) throw new Error('BACKUP_DESTINATION_REQUIRED');
  mkdirSync(dirname(destination),{recursive:true});
  await db.backup(destination);
  return destination;
}
