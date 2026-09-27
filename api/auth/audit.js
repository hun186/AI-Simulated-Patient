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

function isoParam(value,code){
  if(value===undefined||value===null||value==='') return null;
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime())){
    const error=new Error(code);
    error.code=code;
    throw error;
  }
  return date.toISOString();
}

function parseSuccess(value){
  const text=String(value??'all').toLowerCase();
  if(text==='all'||text==='') return null;
  if(text==='success'||text==='true'||text==='1') return true;
  if(text==='failure'||text==='false'||text==='0') return false;
  const error=new Error('INVALID_AUDIT_SUCCESS_FILTER');
  error.code='INVALID_AUDIT_SUCCESS_FILTER';
  throw error;
}

function append(where,params,clause,value){
  params.push(value);
  where.push(clause.replace('?', '$'+params.length));
}

function auditScope(user,{selfOnly=false}={}){
  const where=[];
  const params=[];
  if(selfOnly){
    params.push(user.id,user.id);
    where.push('(e.actor_user_id=$1 or e.target_user_id=$2)');
  }
  return {where,params};
}

function applyDateFilters(scope,{from,to}){
  if(from) append(scope.where,scope.params,'e.created_at >= ?',from);
  if(to) append(scope.where,scope.params,'e.created_at < ?',to);
}

function applyEventFilters(scope,{action,success,actorUserId,targetUserId,queryText}){
  if(action) append(scope.where,scope.params,'e.action = ?',action);
  if(success!==null) append(scope.where,scope.params,'e.success = ?',success);
  if(actorUserId) append(scope.where,scope.params,'e.actor_user_id = ?',actorUserId);
  if(targetUserId) append(scope.where,scope.params,'e.target_user_id = ?',targetUserId);
  if(queryText){
    const like='%'+queryText.toLowerCase()+'%';
    const start=scope.params.length+1;
    scope.params.push(like,like,like,like);
    scope.where.push(
      '(lower(e.identifier) like 
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function publicUser(row,prefix){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:row[prefix+'DisplayName']||'',
    email:row[prefix+'Email']||''
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const page=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:100});
    const offset=(page-1)*pageSize;
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to){
      const error=new Error('INVALID_AUDIT_RANGE');
      error.code='INVALID_AUDIT_RANGE';
      throw error;
    }
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

    const [countRows,rows,actions,actorRows,targetRows]=await Promise.all([
      query(
        `select count(*) as total from auth_audit_events e${whereSql(selected)}`,
        selected.params
      ),
      query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,offset]
      ),
      query(
        `select distinct e.action as value from auth_audit_events e${whereSql(base)} order by e.action`,
        base.params
      ),
      query(
        `select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.actor_user_id
         ${whereSql(actorScope)}
         order by u.display_name,u.email`,
        actorScope.params
      ),
      query(
        `select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.target_user_id
         ${whereSql(targetScope)}
         order by u.display_name,u.email`,
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);

    if(page!==safePage && total>0){
      const safeOffset=(safePage-1)*pageSize;
      const safeRows=await query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,safeOffset]
      );
      rows.splice(0,rows.length,...safeRows);
    }

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:publicUser(row,'actor'),
        target:publicUser(row,'target'),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page:safePage,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:actorRows,
        targets:targetRows
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
+start+
      ' or lower(e.reason) like 
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function publicUser(row,prefix){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:row[prefix+'DisplayName']||'',
    email:row[prefix+'Email']||''
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const page=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:100});
    const offset=(page-1)*pageSize;
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to){
      const error=new Error('INVALID_AUDIT_RANGE');
      error.code='INVALID_AUDIT_RANGE';
      throw error;
    }
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

    const [countRows,rows,actions,actorRows,targetRows]=await Promise.all([
      query(
        `select count(*) as total from auth_audit_events e${whereSql(selected)}`,
        selected.params
      ),
      query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,offset]
      ),
      query(
        `select distinct e.action as value from auth_audit_events e${whereSql(base)} order by e.action`,
        base.params
      ),
      query(
        `select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.actor_user_id
         ${whereSql(actorScope)}
         order by u.display_name,u.email`,
        actorScope.params
      ),
      query(
        `select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.target_user_id
         ${whereSql(targetScope)}
         order by u.display_name,u.email`,
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);

    if(page!==safePage && total>0){
      const safeOffset=(safePage-1)*pageSize;
      const safeRows=await query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,safeOffset]
      );
      rows.splice(0,rows.length,...safeRows);
    }

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:publicUser(row,'actor'),
        target:publicUser(row,'target'),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page:safePage,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:actorRows,
        targets:targetRows
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
+(start+1)+
      ' or lower(e.client_host) like 
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function publicUser(row,prefix){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:row[prefix+'DisplayName']||'',
    email:row[prefix+'Email']||''
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const page=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:100});
    const offset=(page-1)*pageSize;
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to){
      const error=new Error('INVALID_AUDIT_RANGE');
      error.code='INVALID_AUDIT_RANGE';
      throw error;
    }
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

    const [countRows,rows,actions,actorRows,targetRows]=await Promise.all([
      query(
        `select count(*) as total from auth_audit_events e${whereSql(selected)}`,
        selected.params
      ),
      query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,offset]
      ),
      query(
        `select distinct e.action as value from auth_audit_events e${whereSql(base)} order by e.action`,
        base.params
      ),
      query(
        `select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.actor_user_id
         ${whereSql(actorScope)}
         order by u.display_name,u.email`,
        actorScope.params
      ),
      query(
        `select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.target_user_id
         ${whereSql(targetScope)}
         order by u.display_name,u.email`,
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);

    if(page!==safePage && total>0){
      const safeOffset=(safePage-1)*pageSize;
      const safeRows=await query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,safeOffset]
      );
      rows.splice(0,rows.length,...safeRows);
    }

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:publicUser(row,'actor'),
        target:publicUser(row,'target'),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page:safePage,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:actorRows,
        targets:targetRows
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
+(start+2)+
      ' or lower(e.action) like 
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function publicUser(row,prefix){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:row[prefix+'DisplayName']||'',
    email:row[prefix+'Email']||''
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const page=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:100});
    const offset=(page-1)*pageSize;
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to){
      const error=new Error('INVALID_AUDIT_RANGE');
      error.code='INVALID_AUDIT_RANGE';
      throw error;
    }
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

    const [countRows,rows,actions,actorRows,targetRows]=await Promise.all([
      query(
        `select count(*) as total from auth_audit_events e${whereSql(selected)}`,
        selected.params
      ),
      query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,offset]
      ),
      query(
        `select distinct e.action as value from auth_audit_events e${whereSql(base)} order by e.action`,
        base.params
      ),
      query(
        `select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.actor_user_id
         ${whereSql(actorScope)}
         order by u.display_name,u.email`,
        actorScope.params
      ),
      query(
        `select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.target_user_id
         ${whereSql(targetScope)}
         order by u.display_name,u.email`,
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);

    if(page!==safePage && total>0){
      const safeOffset=(safePage-1)*pageSize;
      const safeRows=await query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,safeOffset]
      );
      rows.splice(0,rows.length,...safeRows);
    }

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:publicUser(row,'actor'),
        target:publicUser(row,'target'),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page:safePage,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:actorRows,
        targets:targetRows
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
+(start+3)+')'
    );
  }
}

function whereSql(scope){
  return scope.where.length?' where '+scope.where.join(' and '):'';
}

function publicUser(row,prefix){
  const id=row[prefix+'UserId'];
  if(!id) return null;
  return {
    id,
    displayName:row[prefix+'DisplayName']||'',
    email:row[prefix+'Email']||''
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const user=await requireUser(req,res);
  if(!user) return;

  try{
    const isRestrictedToSelf=!hasPermission(user.role,PERMISSIONS.SECURITY_AUDIT_ALL);
    const page=boundedInt(req.query?.page,{fallback:1,min:1,max:1000000});
    const pageSize=boundedInt(req.query?.pageSize??req.query?.limit,{fallback:25,min:10,max:100});
    const offset=(page-1)*pageSize;
    const from=isoParam(req.query?.from,'INVALID_AUDIT_FROM');
    const to=isoParam(req.query?.to,'INVALID_AUDIT_TO');
    if(from&&to&&from>=to){
      const error=new Error('INVALID_AUDIT_RANGE');
      error.code='INVALID_AUDIT_RANGE';
      throw error;
    }
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

    const [countRows,rows,actions,actorRows,targetRows]=await Promise.all([
      query(
        `select count(*) as total from auth_audit_events e${whereSql(selected)}`,
        selected.params
      ),
      query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,offset]
      ),
      query(
        `select distinct e.action as value from auth_audit_events e${whereSql(base)} order by e.action`,
        base.params
      ),
      query(
        `select distinct e.actor_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.actor_user_id
         ${whereSql(actorScope)}
         order by u.display_name,u.email`,
        actorScope.params
      ),
      query(
        `select distinct e.target_user_id as "userId",u.display_name as "displayName",u.email
         from auth_audit_events e
         join app_users u on u.id=e.target_user_id
         ${whereSql(targetScope)}
         order by u.display_name,u.email`,
        targetScope.params
      )
    ]);

    const total=Number(countRows[0]?.total||0);
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);

    if(page!==safePage && total>0){
      const safeOffset=(safePage-1)*pageSize;
      const safeRows=await query(
        `select e.id,e.action,e.success,e.reason,
          e.actor_user_id as "actorUserId",au.display_name as "actorDisplayName",au.email as "actorEmail",
          e.target_user_id as "targetUserId",tu.display_name as "targetDisplayName",tu.email as "targetEmail",
          e.identifier,e.client_host as "clientHost",e.user_agent as "userAgent",
          e.metadata_json as metadata,e.created_at as "createdAt"
         from auth_audit_events e
         left join app_users au on au.id=e.actor_user_id
         left join app_users tu on tu.id=e.target_user_id
         ${whereSql(selected)}
         order by e.created_at desc,e.id desc
         limit $${selected.params.length+1} offset $${selected.params.length+2}`,
        [...selected.params,pageSize,safeOffset]
      );
      rows.splice(0,rows.length,...safeRows);
    }

    return res.status(200).json({
      events:rows.map(row=>({
        ...row,
        success:Boolean(row.success),
        actor:publicUser(row,'actor'),
        target:publicUser(row,'target'),
        metadata:parseMetadata(row.metadata)
      })),
      pagination:{page:safePage,pageSize,total,totalPages},
      filters:{
        actions:actions.map(row=>row.value),
        actors:actorRows,
        targets:targetRows
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
