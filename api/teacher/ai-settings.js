import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser,requireCsrf } from '../../lib/server-auth.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../../lib/authz.js';
import {
  listVisibleConnections,createConnection,updateConnection,deleteConnection,getManagedConnectionForUse
} from '../../lib/llm/connections.js';
import { testLlmConnection } from '../../lib/llm/provider-gateway.js';
import { recordAuthEvent } from '../../lib/auth-audit.js';
import { setSystemRoute,setCaseRoute,deleteRoute,listVisibleRoutes } from '../../lib/llm/routes.js';

function statusFor(error){
  if(error?.code==='CONNECTION_NOT_FOUND' || error?.code==='ROUTE_NOT_FOUND' || error?.code==='CASE_NOT_FOUND') return 404;
  if(['FORBIDDEN','FORBIDDEN_PRESET','FORBIDDEN_CONNECTION','FORBIDDEN_CASE'].includes(error?.code)) return 403;
  if([
    'INVALID_PRESET','INVALID_BASE_URL','BASE_URL_REQUIRED','API_KEY_REQUIRED','NAME_REQUIRED','MODEL_REQUIRED','INVALID_AGENT_TYPE'
  ].includes(error?.code)) return 400;
  return 500;
}

export default async function handler(req,res){
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor) return;

  if(req.method==='GET'){
    return res.status(200).json({
      connections:await listVisibleConnections(actor),
      routes:await listVisibleRoutes(actor),
      actorRole:actor.role
    });
  }
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!(await requireCsrf(req,res))) return;

  const body=req.body??{};
  const action=String(body.action||'');
  try{
    if(action==='createConnection'){
      const connection=await createConnection(actor,body);
      await recordAuthEvent({
        req,action:'llm.connection.create',success:true,reason:connection.preset,
        actorUserId:actor.id,identifier:connection.name,metadata:{connectionId:connection.id,scopeType:connection.scopeType}
      });
      return res.status(201).json({connection});
    }
    if(action==='updateConnection'){
      const connection=await updateConnection(actor,body.connectionId,body);
      await recordAuthEvent({
        req,action:'llm.connection.update',success:true,reason:connection.preset,
        actorUserId:actor.id,identifier:connection.name,metadata:{connectionId:connection.id}
      });
      return res.status(200).json({connection});
    }
    if(action==='deleteConnection'){
      await deleteConnection(actor,body.connectionId);
      await recordAuthEvent({
        req,action:'llm.connection.delete',success:true,reason:'deleted',
        actorUserId:actor.id,metadata:{connectionId:body.connectionId}
      });
      return res.status(200).json({ok:true});
    }
    if(action==='setSystemRoute'){
      const route=await setSystemRoute(actor,body);
      await recordAuthEvent({
        req,action:'llm.route.set',success:true,reason:'system',
        actorUserId:actor.id,metadata:{routeId:route.id,agentType:route.agentType,connectionId:route.connectionId}
      });
      return res.status(200).json({route});
    }
    if(action==='setCaseRoute'){
      const route=await setCaseRoute(actor,body);
      await recordAuthEvent({
        req,action:'llm.route.set',success:true,reason:'case',
        actorUserId:actor.id,metadata:{routeId:route.id,caseId:route.scopeId,agentType:route.agentType,connectionId:route.connectionId}
      });
      return res.status(200).json({route});
    }
    if(action==='deleteRoute'){
      await deleteRoute(actor,body.routeId);
      await recordAuthEvent({
        req,action:'llm.route.delete',success:true,reason:'deleted',
        actorUserId:actor.id,metadata:{routeId:body.routeId}
      });
      return res.status(200).json({ok:true});
    }
    if(action==='testConnection'){
      const connection=await getManagedConnectionForUse(actor,body.connectionId);
      const result=await testLlmConnection(connection);
      await recordAuthEvent({
        req,action:'llm.connection.test',success:Boolean(result.ok),reason:result.ok?'connected':result.errorCode,
        actorUserId:actor.id,identifier:connection.name,metadata:{connectionId:connection.id,preset:connection.preset}
      });
      return res.status(result.ok?200:502).json({result});
    }
    return res.status(400).json({error:'Unsupported action'});
  }catch(error){
    const status=statusFor(error);
    if(status===500) console.error(error);
    return res.status(status).json({error:status===500?'Unexpected error':error.code});
  }
}
