import { query } from '../db.js';

function safeInt(value){
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?Math.round(number):0;
}

function globRegex(pattern){
  const escaped=String(pattern??'').replace(/[-/\\^$+?.()|[\]{}]/g,'\\$&').replace(/\*/g,'.*');
  return new RegExp('^'+escaped+'$');
}

function specificity(pattern,model){
  if(pattern===model) return Number.MAX_SAFE_INTEGER;
  return String(pattern).replace(/\*/g,'').length;
}

function normalizedDate(value){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) throw new Error('INVALID_PRICING_TIMESTAMP');
  return date;
}

export function deepseekPricingBand(at=new Date()){
  const beijing=new Date(normalizedDate(at).getTime()+8*60*60*1000);
  const weekday=beijing.getUTCDay();
  if(weekday===0 || weekday===6) return 'off_peak';
  const minute=beijing.getUTCHours()*60+beijing.getUTCMinutes();
  const morning=minute>=9*60 && minute<12*60;
  const afternoon=minute>=14*60 && minute<18*60;
  return morning||afternoon?'peak':'off_peak';
}

function pricingBandFor(preset,at){
  return String(preset||'')==='deepseek'?deepseekPricingBand(at):'always';
}

function contextBandFor(preset,inputTokens){
  if(String(preset||'')!=='openai') return 'any';
  return safeInt(inputTokens)>272000?'long':'short';
}

export function openAiServiceMultiplierBps(serviceTier='default'){
  const tier=String(serviceTier||'default').toLowerCase();
  if(['default','auto','standard'].includes(tier)) return 10000;
  if(['flex','batch'].includes(tier)) return 5000;
  if(['priority','fast'].includes(tier)) return 20000;
  return null;
}

function dto(row){
  if(!row) return null;
  return {
    id:row.id,
    preset:row.preset,
    modelPattern:row.model_pattern,
    timeBand:row.time_band||'always',
    contextBand:row.context_band||'any',
    inputMicrousdPerMillion:row.input_microusd_per_million==null?null:safeInt(row.input_microusd_per_million),
    cachedInputMicrousdPerMillion:row.cached_input_microusd_per_million==null?null:safeInt(row.cached_input_microusd_per_million),
    cacheWriteMicrousdPerMillion:row.cache_write_microusd_per_million==null?null:safeInt(row.cache_write_microusd_per_million),
    outputMicrousdPerMillion:row.output_microusd_per_million==null?null:safeInt(row.output_microusd_per_million),
    reasoningMicrousdPerMillion:row.reasoning_microusd_per_million==null?null:safeInt(row.reasoning_microusd_per_million),
    effectiveAt:row.effective_at
  };
}

export async function resolvePricingRule({
  preset,model,at=new Date().toISOString(),inputTokens=0
}){
  const when=normalizedDate(at).toISOString();
  const desiredBand=pricingBandFor(preset,when);
  const desiredContext=contextBandFor(preset,inputTokens);
  const rows=await query(
    `select * from llm_pricing_rules
     where preset=$1 and is_active=true and effective_at <= $2
     order by effective_at desc, created_at desc`,
    [String(preset||''),when]
  );
  const matches=rows.filter(row=>{
    const band=String(row.time_band||'always');
    const context=String(row.context_band||'any');
    return globRegex(row.model_pattern).test(String(model||''))
      && (band==='always' || band===desiredBand)
      && (context==='any' || context===desiredContext);
  });
  if(!matches.length) return null;
  matches.sort((a,b)=>{
    const sa=specificity(a.model_pattern,model),sb=specificity(b.model_pattern,model);
    if(sa!==sb) return sb-sa;
    const contextA=String(a.context_band||'any')===desiredContext?1:0;
    const contextB=String(b.context_band||'any')===desiredContext?1:0;
    if(contextA!==contextB) return contextB-contextA;
    const bandA=String(a.time_band||'always')===desiredBand?1:0;
    const bandB=String(b.time_band||'always')===desiredBand?1:0;
    if(bandA!==bandB) return bandB-bandA;
    const effective=String(b.effective_at).localeCompare(String(a.effective_at));
    if(effective!==0) return effective;
    return String(b.created_at||'').localeCompare(String(a.created_at||''));
  });
  return dto(matches[0]);
}

export function estimateUsageCost({
  usage={},usageStatus='unreported',rule=null,serviceTier='default'
}){
  if(!rule || !['reported','estimated'].includes(String(usageStatus))){
    return {estimatedCostMicrousd:null,pricingStatus:'unpriced',pricingRuleId:null};
  }

  const input=safeInt(usage.inputTokens);
  const cached=Math.min(input,safeInt(usage.cachedInputTokens));
  const cacheWrite=Math.min(Math.max(0,input-cached),safeInt(usage.cacheWriteTokens));
  const output=safeInt(usage.outputTokens);
  const reasoning=Math.min(output,safeInt(usage.reasoningTokens));

  const dimensions=[
    {tokens:Math.max(0,input-cached-cacheWrite),rate:rule.inputMicrousdPerMillion},
    {tokens:cached,rate:rule.cachedInputMicrousdPerMillion},
    {tokens:cacheWrite,rate:rule.cacheWriteMicrousdPerMillion},
    {tokens:Math.max(0,output-reasoning),rate:rule.outputMicrousdPerMillion},
    {tokens:reasoning,rate:rule.reasoningMicrousdPerMillion}
  ];

  let numerator=0n;
  let pricedAny=false;
  let missing=false;
  let nonzero=false;
  for(const item of dimensions){
    if(item.tokens<=0) continue;
    nonzero=true;
    if(item.rate==null){
      missing=true;
      continue;
    }
    pricedAny=true;
    numerator+=BigInt(item.tokens)*BigInt(item.rate);
  }

  if(nonzero && !pricedAny){
    return {estimatedCostMicrousd:null,pricingStatus:'unpriced',pricingRuleId:rule.id};
  }

  if(rule.preset==='openai'){
    const bps=openAiServiceMultiplierBps(serviceTier);
    if(bps==null){
      return {estimatedCostMicrousd:null,pricingStatus:'unpriced',pricingRuleId:rule.id};
    }
    numerator=(numerator*BigInt(bps)+5000n)/10000n;
  }

  const rounded=Number((numerator+500000n)/1000000n);
  return {
    estimatedCostMicrousd:rounded,
    pricingStatus:missing?'partial':'priced',
    pricingRuleId:rule.id
  };
}
