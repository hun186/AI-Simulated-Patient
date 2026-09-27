import { isDatabaseEnabled,query } from '../../lib/db.js';
import { requireUser } from '../../lib/server-auth.js';
import { hasPermission,PERMISSIONS } from '../../lib/authz.js';

function parseMetadata(value){
  if(value==null || typeof value!=='string') return value||{};
  try{return JSON.parse(value);}catch{return {};}
}

function boundedInt(value,{fallback,min,max}){
  const number=Number(value);
  if(!Number.isInteger(number)) return fallback;
  return Math.max(min,Math.min(max,number));
}

function fail(code){
  const error=new Error(code);
  error.code=code;
  return error;
}

function isoParam(value,code){
  if(value===undefined||value===null||value==='') return null;
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime())) throw fail(code);
  return date.toISOString();
}

function parseSuccess(value){
  const text=String(value??'all').toLowerCase();
  if(text==='all'||text==='') return null;
  if(text==='success'||text==='true'||text==='1') return true;
  if(text==='failure'||text==='false'||text==='0') return false;
  throw fail('INVALID_AUDIT_SUCCESS_FILTER');
}

function append(scope,clause,value){
  scope.params.push(value);
  scope.where.push(clause.replace('?', '$'+scope.params.length));
}

function auditScope(user,{selfOnly=false}={}){
  const scope={where:[],params:[]};
  if(selfOnly){
    scope.params.push(user.id,user.id);
    scope.where.push('(e.actor_user_id=$1 or e.target_user_id=$2)');
  }
  return scope;
}

function applyDateFilters(scope,{from,to}){
  if(from) append(scope,'e.created_at >= ?',from);
  if(to) append(scope,'e.created_at < ?',to);
}

function applyEventFilters(scope,{action,success,actorUserId,targetUserId,queryText}){
  if(action) append(scope,'e.action = ?',action);
  if(success!==null) append(scope,'e.success = ?',success);
  if(actorUserId) append(scope,'e.actor_user_id = ?',actorUserId);
  if(targetUserId) append(scope,'e.target_user_id = ?',targetUserId);
  if(queryText){
    const like='%'+queryText.toLowerCase()+'%';
    const start=scope.params.length+1;
    scope.params.push(like,like,like,like);
    scope.where.push(
      '(lower(e.identifier) like $'+start+
      ' or lower(e.reason) like $'+(start+1)+
      ' or lower(e.client_host) like $'+(start+2)+
      ' or lower(e.action) like $'+(start+3)+')'
    );
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function userProjection(row,prefix,{viewerId,canViewAll}){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:canViewAll||id===viewerId?(row[prefix+'DisplayName']||''):'',
    email:canViewAll||id===viewerId?(row[prefix+'Email']||''):''
  };
}

const EVENT_SELECT=`select e.id,e.action,e.success,e.reason,
  e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
  e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
  e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
  e.metadata_json as metadata,e.created_at as "createdAt"
 from auth_audit_events e
 left join app_users au on au.id=e.actor_user_id
 left join app_users tu on tu.id=e.target_user_id`;

async function pageRows(scope,pageSize,offset){
  return query(
    EVENT_SELECT+whereSql(scope)+
    ' order by e.created_at desc,e.id desc limit $'+(scope.params.length+1)+' offset $'+(scope.params.length+2),
    [...scope.params,pageSize,offset]
  );
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const requestedPage=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:200});
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to) throw fail('INVALID_AUDIT_RANGE');

    const filters={
      from,to,
      action:String(req.query?.action||'').trim(),
      success:parseSuccess(req.query?.success),
      actorUserId:String(req.query?.actorUserId||'').trim(),
      targetUserId:String(req.query?.targetUserId||'').trim(),
      queryText:String(req.query?.q||'').trim().slice(0,160)
    };

    const base=auditScope(user,{selfOnly:isRestrictedToSelf});
    applyDateFilters(base,filters);

    const selected={where:[...base.where],params:[...base.params]};
    applyEventFilters(selected,filters);

    const actorScope={where:[...base.where,'e.actor_user_id is not null'],params:[...base.params]};
    const targetScope={where:[...base.where,'e.target_user_id is not null'],params:[...base.params]};

    const [countRows,actions,actorRows,targetRows]=await Promise.all([
      query('select count(*) as total from auth_audit_events e'+whereSql(selected),selected.params),
      query('select distinct e.action as value from auth_audit_events e'+whereSql(base)+' order by e.action',base.params),
      query(
        'select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email '+
        'from auth_audit_events e join app_users u on u.id=e.actor_user_id'+whereSql(actorScope)+
        ' order by u.display_name,u.email',
        actorScope.params
      ),
      query(
        'select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email '+
        'from auth_audit_events e join app_users u on u.id=e.target_user_id'+whereSql(targetScope)+
        ' order by u.display_name,u.email',
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(requestedPage,totalPages);
    const rows=await pageRows(selected,pageSize,(page-1)*pageSize);

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:userProjection(row,'actor',{viewerId:user.id,canViewAll:!isRestrictedToSelf}),
        target:userProjection(row,'target',{viewerId:user.id,canViewAll:!isRestrictedToSelf}),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:isRestrictedToSelf?actorRows.filter(row=>row.userId===user.id):actorRows,
        targets:isRestrictedToSelf?targetRows.filter(row=>row.userId===user.id):targetRows
      },
      isRestrictedToSelf
    });
  }catch(error){
    if([
      'INVALID_AUDIT_FROM','INVALID_AUDIT_TO','INVALID_AUDIT_RANGE','INVALID_AUDIT_SUCCESS_FILTER'
    ].includes(error?.code)) return res.status(400).json({error:error.code});
    console.error(error);
    return res.status(500).json({error:'Unexpected error'});
  }
}
