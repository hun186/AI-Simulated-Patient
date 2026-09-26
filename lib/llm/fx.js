import { query } from '../db.js';

function normalizedDate(value){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw new Error('INVALID_FX_TIMESTAMP');
  return date;
}

export async function resolveFxRate({
  baseCurrency='USD',quoteCurrency='TWD',at=new Date().toISOString()
}={}){
  const when=normalizedDate(at).toISOString();
  const rows=await query(
    `select * from llm_fx_rates
     where base_currency=$1 and quote_currency=$2 and is_active=true and effective_at <= $3
     order by effective_at desc,created_at desc limit 1`,
    [String(baseCurrency),String(quoteCurrency),when]
  );
  const row=rows[0];
  if(!row) return null;
  return {
    id:row.id,
    baseCurrency:row.base_currency,
    quoteCurrency:row.quote_currency,
    rateMicrounitsPerUnit:Number(row.rate_microunits_per_unit),
    rate:Number(row.rate_microunits_per_unit)/1000000,
    source:row.source||'',
    effectiveAt:row.effective_at
  };
}

export function convertMicrousdToMicrontd(microusd,fxRate){
  if(microusd==null || !fxRate?.rateMicrounitsPerUnit) return null;
  const usd=BigInt(Math.max(0,Math.round(Number(microusd))));
  const rate=BigInt(Math.max(1,Math.round(Number(fxRate.rateMicrounitsPerUnit))));
  return Number((usd*rate+500000n)/1000000n);
}
