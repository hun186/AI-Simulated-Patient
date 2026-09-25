let client=null;

async function connection(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL mode');
  if(!client){
    const {neon}=await import('@neondatabase/serverless');
    client=neon(process.env.DATABASE_URL);
  }
  return client;
}

export async function queryPostgres(text,params=[]){
  return (await connection()).query(text,params);
}

export function postgresInfo(){
  return {driver:'postgres',configured:Boolean(process.env.DATABASE_URL)};
}
