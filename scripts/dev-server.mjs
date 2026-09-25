import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

import casesHandler from '../api/cases.js';
import chatHandler from '../api/chat.js';
import coachHandler from '../api/coach.js';
import evaluateHandler from '../api/evaluate.js';
import runtimeHandler from '../api/runtime.js';
import sessionsHandler from '../api/sessions.js';
import loginHandler from '../api/auth/login.js';
import logoutHandler from '../api/auth/logout.js';
import meHandler from '../api/auth/me.js';
import bootstrapHandler from '../api/auth/bootstrap.js';
import changePasswordHandler from '../api/auth/change-password.js';
import authAuditHandler from '../api/auth/audit.js';
import { applySecurityHeaders,isProductionEnv } from '../lib/request-security.js';
import { databaseDriver,databaseInfo } from '../lib/db.js';
import teacherCasesHandler from '../api/teacher/cases.js';
import teacherUsersHandler from '../api/teacher/users.js';
import teacherRecordsHandler from '../api/teacher/records.js';
import healthHandler from '../api/health.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.PORT||3000);
const driver=databaseDriver();
if(driver==='sqlite' && !process.env.ADMIN_SETUP_KEY && !isProductionEnv()){
  process.env.ADMIN_SETUP_KEY=randomBytes(24).toString('base64url');
  console.log('[setup] Local first-admin setup key: '+process.env.ADMIN_SETUP_KEY);
}
if(driver==='sqlite'){
  const info=await databaseInfo();
  console.log('[db] SQLite: '+info.path+' (WAL='+info.wal+', schema='+info.schemaVersion+')');
}else if(driver==='postgres'){
  console.log('[db] PostgreSQL mode');
}else{
  console.log('[db] Browser/localStorage demo mode');
}
if(isProductionEnv() && driver!=='browser' && !process.env.ADMIN_SETUP_KEY){
  console.warn('[security] ADMIN_SETUP_KEY is not set. First-admin bootstrap will be unavailable until it is configured.');
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const routes=new Map([
  ['/api/cases',casesHandler],['/api/chat',chatHandler],['/api/coach',coachHandler],['/api/evaluate',evaluateHandler],
  ['/api/runtime',runtimeHandler],['/api/health',healthHandler],['/api/sessions',sessionsHandler],['/api/auth/login',loginHandler],['/api/auth/logout',logoutHandler],
  ['/api/auth/me',meHandler],['/api/auth/bootstrap',bootstrapHandler],['/api/auth/change-password',changePasswordHandler],['/api/auth/audit',authAuditHandler],['/api/teacher/cases',teacherCasesHandler],
  ['/api/teacher/users',teacherUsersHandler],['/api/teacher/records',teacherRecordsHandler]
]);

async function parseBody(req){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method)) return {};
  let text=''; for await(const chunk of req) text+=chunk;
  if(!text) return {};
  try{return JSON.parse(text);}catch{return {};}
}
function makeResponse(res){
  let statusCode=200;
  return {
    status(code){statusCode=code;return this;},
    setHeader(name,value){res.setHeader(name,value);},
    json(data){res.writeHead(statusCode,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));},
    end(data=''){res.writeHead(statusCode);res.end(data);}
  };
}

http.createServer(async(req,res)=>{
  try{
    applySecurityHeaders(res);
    const parsedUrl=new URL(req.url,'http://localhost');
    req.query=Object.fromEntries(parsedUrl.searchParams.entries());
    const path=parsedUrl.pathname;
    if(routes.has(path)){req.body=await parseBody(req);return await routes.get(path)(req,makeResponse(res));}
    const filePath=path==='/'?'/index.html':path;
    if(!['/index.html','/styles.css','/formal.css','/app.js','/formal-app.js'].includes(filePath)){res.writeHead(404);return res.end('Not found');}
    const file=await readFile(join(root,filePath));
    res.writeHead(200,{'content-type':mime[extname(filePath)]||'application/octet-stream'});res.end(file);
  }catch(error){
    console.error(error);
    if(!res.headersSent) res.writeHead(500,{'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'Unexpected server error'}));
  }
}).listen(port,()=>console.log(`AI simulated patient: http://localhost:${port}`));
