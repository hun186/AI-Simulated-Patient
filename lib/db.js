let cachedDriver=null;
let cachedAdapter=null;

export function databaseDriver(){
  const explicit=String(process.env.DB_DRIVER||'').trim().toLowerCase();
  if(['browser','demo','none','off'].includes(explicit)) return 'browser';
  if(['postgres','postgresql','neon'].includes(explicit)) return 'postgres';
  if(explicit==='sqlite') return 'sqlite';
  if(process.env.DATABASE_URL) return 'postgres';
  if(process.env.VERCEL) return 'browser';
  return 'sqlite';
}

export function isDatabaseEnabled(){
  return databaseDriver()!=='browser';
}

async function adapter(){
  const driver=databaseDriver();
  if(driver==='browser') throw new Error('DATABASE_NOT_CONFIGURED');
  if(cachedAdapter && cachedDriver===driver) return cachedAdapter;
  cachedDriver=driver;
  cachedAdapter=driver==='sqlite'
    ? await import('./db-sqlite.js')
    : await import('./db-postgres.js');
  return cachedAdapter;
}

export async function query(text,params=[]){
  const driver=databaseDriver();
  const a=await adapter();
  return driver==='sqlite' ? a.querySqlite(text,params) : a.queryPostgres(text,params);
}

export async function databaseInfo(){
  const driver=databaseDriver();
  if(driver==='browser') return {driver:'browser'};
  const a=await adapter();
  return driver==='sqlite' ? a.sqliteInfo() : a.postgresInfo();
}

export async function backupDatabase(destination){
  const driver=databaseDriver();
  if(driver!=='sqlite') throw new Error('BACKUP_SUPPORTED_ONLY_FOR_SQLITE');
  const a=await adapter();
  return a.backupSqlite(destination);
}
