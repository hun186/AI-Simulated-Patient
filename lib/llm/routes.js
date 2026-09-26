import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { ensureBuiltinCase } from '../server-cases.js';
import { ROLE_ADMIN,ROLE_TEACHER } from '../authz.js';

const AGENTS=['patient','coach','evaluator'];

function fail(code,message=code){
  const error=new Error(message);
  error.code=code;
  return error;
}

function assertAgent(agentType){
  if(!AGENTS.includes(agentType)) throw fail('INVALID_AGENT_TYPE');
}

function parseConfig(value){
  if(value==null) return {};
  if(typeof value==='string'){
    try{return JSON.parse(value);}catch{return {};}
  }
  return value&&typeof value==='object'?value:{};
}

function routeDto(row){
  if(!row) return null;
  return {
    id:row.id,
    scopeType:row.scope_type,
    scopeId:row.scope_id||null,
    ownerUserId:row.owner_user_id||null,
    agentType:row.agent_type,
    connectionId:row.connection_id,
    providerKind:row.provider_kind,
    preset:row.preset,
    model:row.model,
    config:parseConfig(row.config_json),
    createdBy:row.created_by||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

async function connectionRow(id){
  const rows=await query('select * from llm_provider_connections where id=$1 and is_active=true limit 1',[id]);
  return rows[0]||null;
}

async function caseRow(caseId){
  await ensureBuiltinCase();
  const rows=await query('select id,created_by,status from cases where id=$1 limit 1',[caseId]);
  return rows[0]||null;
}

async function existingRoute(scopeType,scopeId,agentType,ownerUserId=null){
  const rows=await query(
    `select r.*,c.provider_kind,c.preset
     from llm_agent_routes r join llm_provider_connections c on c.id=r.connection_id
     where r.scope_type=$1
       and ((r.scope_id=$2) or (r.scope_id is null and $2 is null))
       and r.agent_type=$3
       and ((r.owner_user_id=$4) or (r.owner_user_id is null and $4 is null))
     limit 1`,
    [scopeType,scopeId,agentType,ownerUserId]
  );
  return rows[0]||null;
}

async function saveRoute({scopeType,scopeId=null,ownerUserId=null,agentType,connection,model,config,actor}){
  assertAgent(agentType);
  const chosenModel=String(model||connection.default_model||'').trim();
  if(!chosenModel) throw fail('MODEL_REQUIRED');
  const configJson=JSON.stringify(config&&typeof config==='object'?config:{});
  const existing=await existingRoute(scopeType,scopeId,agentType,ownerUserId);
  if(existing){
    await query(
      `update llm_agent_routes
       set connection_id=$2,model=$3,config_json=$4::jsonb,created_by=$5,owner_user_id=$6,updated_at=now()
       where id=$1`,
      [existing.id,connection.id,chosenModel,configJson,actor.id,ownerUserId]
    );
    return (await routeById(existing.id));
  }
  const id=randomUUID();
  await query(
    `insert into llm_agent_routes
      (id,scope_type,scope_id,owner_user_id,agent_type,connection_id,model,config_json,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [id,scopeType,scopeId,ownerUserId,agentType,connection.id,chosenModel,configJson,actor.id]
  );
  return routeById(id);
}

async function routeById(id){
  const rows=await query(
    `select r.*,c.provider_kind,c.preset
     from llm_agent_routes r join llm_provider_connections c on c.id=r.connection_id
     where r.id=$1 limit 1`,
    [id]
  );
  return routeDto(rows[0]);
}

export async function setSystemRoute(actor,{agentType,connectionId,model=null,config={}}){
  if(actor?.role!==ROLE_ADMIN) throw fail('FORBIDDEN');
  assertAgent(agentType);
  const connection=await connectionRow(connectionId);
  if(!connection || connection.scope_type!=='system') throw fail('FORBIDDEN_CONNECTION');
  return saveRoute({
    scopeType:'system',scopeId:null,ownerUserId:null,agentType,connection,model,config,actor
  });
}

export async function setCaseRoute(actor,{caseId,agentType,connectionId,model=null,config={}}){
  if(!actor || ![ROLE_ADMIN,ROLE_TEACHER].includes(actor.role)) throw fail('FORBIDDEN');
  assertAgent(agentType);
  const foundCase=await caseRow(caseId);
  if(!foundCase) throw fail('CASE_NOT_FOUND');
  const connection=await connectionRow(connectionId);
  if(!connection) throw fail('FORBIDDEN_CONNECTION');

  let ownerUserId=null;
  if(actor.role===ROLE_ADMIN){
    if(connection.scope_type!=='system') throw fail('FORBIDDEN_CONNECTION');
  }else{
    if(foundCase.created_by && foundCase.created_by!==actor.id) throw fail('FORBIDDEN_CASE');
    if(connection.scope_type!=='teacher' || connection.owner_user_id!==actor.id){
      throw fail('FORBIDDEN_CONNECTION');
    }
    ownerUserId=actor.id;
  }

  return saveRoute({
    scopeType:'case',scopeId:caseId,ownerUserId,agentType,connection,model,config,actor
  });
}

export async function deleteRoute(actor,routeId){
  const rows=await query('select * from llm_agent_routes where id=$1 limit 1',[routeId]);
  const route=rows[0];
  if(!route) throw fail('ROUTE_NOT_FOUND');
  if(actor?.role!==ROLE_ADMIN){
    if(actor?.role!==ROLE_TEACHER || route.scope_type!=='case' || route.owner_user_id!==actor.id){
      throw fail('FORBIDDEN');
    }
    const foundCase=await caseRow(route.scope_id);
    if(!foundCase || (foundCase.created_by && foundCase.created_by!==actor.id)) throw fail('FORBIDDEN_CASE');
  }
  await query('delete from llm_agent_routes where id=$1',[routeId]);
}

export async function resolveAgentRoutes({caseId,routeOwnerUserId=null}){
  await ensureBuiltinCase();
  const rows=await query(
    `select r.*,c.provider_kind,c.preset
     from llm_agent_routes r
     join llm_provider_connections c on c.id=r.connection_id
     where c.is_active=true
       and (
         (r.scope_type='system' and r.owner_user_id is null)
         or
         (r.scope_type='case' and r.scope_id=$1
           and (r.owner_user_id is null or r.owner_user_id=$2))
       )
     order by
       case
         when r.scope_type='case' and r.owner_user_id=$2 then 0
         when r.scope_type='case' and r.owner_user_id is null then 1
         when r.scope_type='system' then 2
         else 3
       end,
       r.updated_at desc`,
    [caseId,routeOwnerUserId]
  );
  const result={patient:null,coach:null,evaluator:null};
  for(const row of rows){
    if(result[row.agent_type]) continue;
    result[row.agent_type]=routeDto(row);
  }
  return result;
}

export function snapshotAgentRoutes(routes){
  const result={patient:null,coach:null,evaluator:null};
  for(const agent of AGENTS){
    const route=routes?.[agent];
    if(!route) continue;
    result[agent]={
      routeId:route.id||route.routeId||null,
      connectionId:route.connectionId||null,
      providerKind:route.providerKind,
      preset:route.preset,
      model:route.model,
      config:parseConfig(route.config)
    };
  }
  return result;
}

export async function listVisibleRoutes(actor){
  let rows;
  if(actor.role===ROLE_ADMIN){
    rows=await query(
      `select r.*,c.provider_kind,c.preset
       from llm_agent_routes r join llm_provider_connections c on c.id=r.connection_id
       order by r.updated_at desc`
    );
  }else if(actor.role===ROLE_TEACHER){
    rows=await query(
      `select r.*,c.provider_kind,c.preset
       from llm_agent_routes r join llm_provider_connections c on c.id=r.connection_id
       where r.owner_user_id is null
          or r.owner_user_id=$1
       order by r.updated_at desc`,
      [actor.id]
    );
  }else{
    throw fail('FORBIDDEN');
  }
  return rows.map(routeDto);
}
