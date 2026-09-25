import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt=promisify(scryptCb);
export const MIN_PASSWORD_LENGTH=12;
export const MAX_PASSWORD_LENGTH=256;
export const DUMMY_PASSWORD_SALT='00000000000000000000000000000000';
export const DUMMY_PASSWORD_HASH=scryptSync('aisp-dummy-password-for-timing-balance',DUMMY_PASSWORD_SALT,64).toString('hex');

export function validatePassword(password){
  if(typeof password!=='string' || password.length<MIN_PASSWORD_LENGTH) throw new Error(`密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`);
  if(password.length>MAX_PASSWORD_LENGTH) throw new Error('密碼過長。');
}

export async function hashPassword(password){
  validatePassword(password);
  const salt=randomBytes(16).toString('hex');
  const derived=await scrypt(password,salt,64);
  return {salt,hash:Buffer.from(derived).toString('hex')};
}

export async function verifyPassword(password,salt,expectedHash){
  try{
    const derived=Buffer.from(await scrypt(String(password),String(salt),64));
    const expected=Buffer.from(String(expectedHash),'hex');
    return derived.length===expected.length && timingSafeEqual(derived,expected);
  }catch{return false;}
}

export function newSessionToken(){return randomBytes(32).toString('base64url');}
export function newCsrfToken(){return randomBytes(32).toString('base64url');}
export function hashSessionToken(token){return createHash('sha256').update(token).digest('hex');}
export function hashCsrfToken(token){return createHash('sha256').update(token).digest('hex');}
