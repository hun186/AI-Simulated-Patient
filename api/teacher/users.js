import { isDatabaseEnabled } from '../../lib/db.js';
import { requireUser,createUser } from '../../lib/server-auth.js';
import { query } from '../../lib/db.js';

export default async function handler(req,res){
  if(!isDatabaseEnabled()) return res.status(409).json({error:'Database mode is not enabled'});
  const teacher=await requireUser(req,res,['teacher']);
  if(!teacher) return;
  if(req.method==='GET'){
    const rows=await query('select id,email,display_name as "displayName",role,is_active as "isActive",created_at as "createdAt" from app_users order by created_at desc');
    return res.status(200).json({users:rows});
  }
  if(req.method==='POST'){
    const {email,password,displayName,role='student'}=req.body??{};
    if(!['student','teacher'].includes(role)) return res.status(400).json({error:'Invalid role'});
    if(!email || !displayName || !password || password.length<10) return res.status(400).json({error:'Email, display name and password (10+ chars) required'});
    try{return res.status(201).json({user:await createUser({email,password,displayName,role})});}
    catch(error){
      if(String(error.message).includes('duplicate')) return res.status(409).json({error:'Email already exists'});
      throw error;
    }
  }
  return res.status(405).json({error:'Method not allowed'});
}
