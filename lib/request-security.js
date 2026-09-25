export function clientHost(req){
  const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim();
  return (forwarded || req.socket?.remoteAddress || 'unknown').slice(0,128);
}

export function userAgent(req){
  return String(req.headers?.['user-agent']||'').slice(0,512);
}

function firstHeader(value){
  return String(value||'').split(',')[0].trim();
}

export function isProductionEnv(){
  const value=String(process.env.APP_ENV||process.env.NODE_ENV||process.env.VERCEL_ENV||'').toLowerCase();
  return value==='prod' || value==='production';
}

export function allowedOrigins(req){
  const configured=String(process.env.AUTH_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(configured.length) return configured;
  const host=firstHeader(req.headers?.['x-forwarded-host']) || firstHeader(req.headers?.host);
  if(!host) return [];
  const proto=firstHeader(req.headers?.['x-forwarded-proto']) || (isProductionEnv()?'https':'http');
  return [`${proto}://${host}`];
}

export function requireTrustedOrigin(req,res){
  const origin=String(req.headers?.origin||'').replace(/\/$/,'');
  if(!origin) return true;
  const allowed=allowedOrigins(req).map(x=>x.replace(/\/$/,''));
  if(allowed.includes(origin)) return true;
  res.status(403).json({error:'Request origin is not allowed'});
  return false;
}

export function applySecurityHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control','no-store');
}
