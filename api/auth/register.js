import { isDatabaseEnabled,query } from '../../lib/db.js';
import { createUser,countAdmins } from '../../lib/server-auth.js';
import { requireTrustedOrigin } from '../../lib/request-security.js';
import { consumeAttempt } from '../../lib/auth-throttle.js';
import { recordAuthEvent } from '../../lib/auth-audit.js';

const STUDENT_MESSAGE='申請已送出。若資料可受理，請等待教師或系統管理員核准後再登入。';
const TEACHER_MESSAGE='申請已送出。若資料可受理，請等待系統管理員核准後再登入。';

function normalizeEmail(value){
  return String(value||'').trim().toLowerCase();
}
function validEmail(value){
  return /^[^\s@]+@[^\s@]+$/.test(value);
}
async function findRequestedTeacher(email){
  if(!email)return null;
  const rows=await query(
    `select id,email from app_users
     where lower(email)=lower($1) and role='teacher'
       and account_status='active' and is_active=true
     limit 1`,
    [email]
  );
  return rows[0]||null;
}
async function assignTeacher(teacherId,studentId){
  if(!teacherId||!studentId)return;
  await query(
    `insert into teacher_student_assignments (teacher_user_id,student_user_id,assigned_by)
     values ($1,$2,null) on conflict do nothing`,
    [teacherId,studentId]
  );
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Server registration requires database mode'});
  if(!requireTrustedOrigin(req,res)) return;
  if(!(await countAdmins())) return res.status(503).json({error:'系統尚未完成管理員初始化，暫不接受帳號申請。'});

  const body=req.body??{};
  const displayName=String(body.displayName||'').trim();
  const email=normalizeEmail(body.email);
  const password=String(body.password||'');
  const requestedRole=String(body.role??'student').trim().toLowerCase();
  const role=requestedRole==='teacher'?'teacher':requestedRole==='student'?'student':'';
  const requestedTeacherEmail=role==='student'?normalizeEmail(body.requestedTeacherEmail):'';

  if(!role) return res.status(400).json({error:'申請身份必須是學生或教師。'});

  const ipRetry=await consumeAttempt(req,'register-ip','*',{
    limit:Number(process.env.AUTH_REGISTER_IP_LIMIT||30),
    windowSeconds:3600,
    blockSeconds:900
  });
  if(ipRetry){
    res.setHeader('Retry-After',String(ipRetry));
    return res.status(429).json({error:'申請次數過多，請稍後再試。'});
  }

  if(!displayName || displayName.length>120 || !validEmail(email)){
    return res.status(400).json({error:'請填寫有效姓名與 Email。'});
  }
  if(password.length<12 || password.length>256){
    return res.status(400).json({error:'密碼需為 12–256 個字元。'});
  }

  const emailRetry=await consumeAttempt(req,'register-email',email,{
    limit:Number(process.env.AUTH_REGISTER_EMAIL_LIMIT||5),
    windowSeconds:3600,
    blockSeconds:900
  });
  if(emailRetry){
    res.setHeader('Retry-After',String(emailRetry));
    return res.status(429).json({error:'申請次數過多，請稍後再試。'});
  }

  const requestedTeacher=role==='student'
    ? await findRequestedTeacher(requestedTeacherEmail)
    : null;
  let applicant=null;
  let reason='pending_created';

  try{
    applicant=await createUser({email,password,displayName,role,status:'pending'});
  }catch(error){
    if(error?.code!=='23505' && !String(error.message).toLowerCase().includes('unique')){
      if(String(error.message).includes('密碼')) return res.status(400).json({error:error.message});
      throw error;
    }
    const existing=(await query(
      "select id,email,role,account_status from app_users where lower(email)=lower($1) limit 1",
      [email]
    ))[0];
    if(existing?.role===role && existing.account_status==='pending'){
      applicant=existing;
      reason='pending_already_exists';
    }else{
      reason='generic_existing_account';
    }
  }

  if(role==='student' && applicant && requestedTeacher){
    await assignTeacher(requestedTeacher.id,applicant.id);
  }

  await recordAuthEvent({
    req,
    action:'account.registration_requested',
    success:true,
    reason,
    targetUserId:applicant?.id||null,
    identifier:email,
    metadata:{role,teacherRequested:role==='student'&&Boolean(requestedTeacher)}
  });

  return res.status(202).json({
    accepted:true,
    message:role==='teacher'?TEACHER_MESSAGE:STUDENT_MESSAGE
  });
}
