import { isDatabaseEnabled,query } from '../../lib/db.js';
import {
  requireUser,requireCsrf,createUser,invalidateUserSessions,resetPasswordByStaff
} from '../../lib/server-auth.js';
import { rolesCreatableBy,ROLE_ADMIN,ROLE_TEACHER,ROLE_STUDENT } from '../../lib/authz.js';
import { recordAuthEvent } from '../../lib/auth-audit.js';

async function targetUser(userId){
  const rows=await query(
    'select id,email,display_name,role,account_status,is_active from app_users where id=$1 limit 1',
    [userId]
  );
  return rows[0]||null;
}

async function teacherOwnsStudent(teacherId,studentId){
  const rows=await query(
    'select 1 from teacher_student_assignments where teacher_user_id=$1 and student_user_id=$2 limit 1',
    [teacherId,studentId]
  );
  return Boolean(rows[0]);
}

async function canManage(actor,target){
  if(actor.role===ROLE_ADMIN) return true;
  return actor.role===ROLE_TEACHER && target?.role===ROLE_STUDENT && await teacherOwnsStudent(actor.id,target.id);
}

export default async function handler(req,res){
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const actor=await requireUser(req,res,[ROLE_ADMIN,ROLE_TEACHER]);
  if(!actor) return;

  if(req.method==='GET'){
    let rows;
    if(actor.role===ROLE_ADMIN){
      rows=await query(
        `select id,email,display_name as "displayName",role,account_status as "accountStatus",
         is_active as "isActive",created_at as "createdAt"
         from app_users order by created_at desc`
      );
    }else{
      rows=await query(
        `select distinct u.id,u.email,u.display_name as "displayName",u.role,
         u.account_status as "accountStatus",u.is_active as "isActive",u.created_at as "createdAt"
         from app_users u
         where u.id=$1 or exists (
           select 1 from teacher_student_assignments a
           where a.teacher_user_id=$1 and a.student_user_id=u.id
         )
         order by u.created_at desc`,
        [actor.id]
      );
    }
    const assignments=actor.role===ROLE_ADMIN
      ? await query('select teacher_user_id as "teacherUserId",student_user_id as "studentUserId" from teacher_student_assignments order by created_at desc')
      : [];
    return res.status(200).json({users:rows,assignments,actorRole:actor.role,creatableRoles:rolesCreatableBy(actor.role)});
  }

  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!(await requireCsrf(req,res))) return;

  const {
    action='create',email,password,displayName,role=ROLE_STUDENT,userId,
    teacherUserId,studentUserId,newPassword
  }=req.body??{};

  if(action==='create'){
    if(!rolesCreatableBy(actor.role).includes(role)) return res.status(403).json({error:'You cannot create that role'});
    try{
      const user=await createUser({email,password,displayName,role,status:'active'});
      if(actor.role===ROLE_TEACHER && role===ROLE_STUDENT){
        await query(
          `insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by)
           values ($1,$2,$1) on conflict do nothing`,
          [actor.id,user.id]
        );
      }else if(actor.role===ROLE_ADMIN && role===ROLE_STUDENT && teacherUserId){
        const teacher=await targetUser(teacherUserId);
        if(!teacher || teacher.role!==ROLE_TEACHER) return res.status(400).json({error:'Invalid teacher assignment'});
        await query(
          `insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by)
           values ($1,$2,$3) on conflict do nothing`,
          [teacherUserId,user.id,actor.id]
        );
      }
      await recordAuthEvent({
        req,action:'account.create',success:true,reason:'staff_created',
        actorUserId:actor.id,targetUserId:user.id,identifier:user.email,metadata:{role:user.role}
      });
      return res.status(201).json({user});
    }catch(error){
      if(error?.code==='23505' || String(error.message).toLowerCase().includes('duplicate')) return res.status(409).json({error:'Email already exists'});
      if(String(error.message).includes('密碼')) return res.status(400).json({error:error.message});
      throw error;
    }
  }

  if(action==='assignStudent' || action==='unassignStudent'){
    if(actor.role!==ROLE_ADMIN) return res.status(403).json({error:'Administrator required'});
    const teacher=await targetUser(teacherUserId);
    const student=await targetUser(studentUserId);
    if(!teacher || teacher.role!==ROLE_TEACHER || !student || student.role!==ROLE_STUDENT) return res.status(400).json({error:'Invalid teacher/student assignment'});
    if(action==='assignStudent'){
      await query(
        `insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by)
         values ($1,$2,$3) on conflict do nothing`,
        [teacher.id,student.id,actor.id]
      );
    }else{
      await query('delete from teacher_student_assignments where teacher_user_id=$1 and student_user_id=$2',[teacher.id,student.id]);
    }
    await recordAuthEvent({
      req,action:`account.${action}`,success:true,reason:action,
      actorUserId:actor.id,targetUserId:student.id,identifier:student.email,metadata:{teacherUserId:teacher.id}
    });
    return res.status(200).json({ok:true});
  }

  const target=await targetUser(userId);
  if(!target) return res.status(404).json({error:'User not found'});
  if(!(await canManage(actor,target))) return res.status(403).json({error:'Forbidden'});
  if(target.id===actor.id && action==='suspend') return res.status(400).json({error:'You cannot suspend your own account'});

  if(action==='suspend' || action==='activate'){
    const status=action==='suspend'?'suspended':'active';
    await query(
      'update app_users set account_status=$2,is_active=$3,updated_at=now() where id=$1',
      [target.id,status,status==='active']
    );
    if(status==='suspended') await invalidateUserSessions(target.id);
    await recordAuthEvent({
      req,action:`account.${action}`,success:true,reason:status,
      actorUserId:actor.id,targetUserId:target.id,identifier:target.email
    });
    return res.status(200).json({ok:true,accountStatus:status});
  }

  if(action==='resetPassword'){
    try{
      await resetPasswordByStaff({actor,targetUserId:target.id,newPassword,req});
      return res.status(200).json({ok:true});
    }catch(error){
      if(String(error.message).includes('密碼')) return res.status(400).json({error:error.message});
      throw error;
    }
  }

  return res.status(400).json({error:'Unsupported action'});
}
