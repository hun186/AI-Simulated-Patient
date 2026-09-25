import { neon } from '@neondatabase/serverless';

export function isDatabaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  return neon(process.env.DATABASE_URL);
}

export async function query(text, params = []) {
  return db()(text, params);
}
