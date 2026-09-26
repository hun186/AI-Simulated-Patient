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

function dto(row){
  if(!row) return null;
  return {
    id:row.id,
    preset:row.preset,
    modelPattern:row.model_pattern,
    inputMicrousdPerMillion:row.input_microusd_per_million==null?null:safeInt(row.input_microusd_per_million),
    cachedInputMicrousdPerMillion:row.cached_input_microusd_per_million==null?null:safeInt(row.cached_input_microusd_per_million),
    outputMicrousdPerMillion:row.output_microusd_per_million==null?null:safeInt(row.output_microusd_per_million),
    reasoningMicrousdPerMillion:row.reasoning_microusd_per_million==null?null:safeInt(row.reasoning_microusd_per_million),
    effectiveAt:row.effective_at
  };
}

export async function resolvePricingRule({preset,model,at=new Date().toISOString()}){
  const rows=await query(
    `select * from llm_pricing_rules
     where preset=$1 and is_active=true and effective_at <= $2
     order by effective_at desc, created_at desc`,
    [String(preset||''),String(at)]
  );
  const matches=rows.filter(row=>globRegex(row.model_pattern).test(String(model||'')));
  if(!matches.length) return null;
  matches.sort((a,b)=>{
    const sa=specificity(a.model_pattern,model),sb=specificity(b.model_pattern,model);
    if(sa!==sb) return sb-sa;
    return String(b.effective_at).localeCompare(String(a.effective_at));
  });
  return dto(matches[0]);
}

export function estimateUsageCost({usage={},usageStatus='unreported',rule=null}){
  if(!rule || !['reported','estimated'].includes(String(usageStatus))){
    return {estimatedCostMicrousd:null,pricingStatus:'unpriced',pricingRuleId:null};
  }

  const input=safeInt(usage.inputTokens);
  const cached=Math.min(input,safeInt(usage.cachedInputTokens));
  const output=safeInt(usage.outputTokens);
  const reasoning=Math.min(output,safeInt(usage.reasoningTokens));

  const dimensions=[
    {tokens:Math.max(0,input-cached),rate:rule.inputMicrousdPerMillion},
    {tokens:cached,rate:rule.cachedInputMicrousdPerMillion},
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
  const rounded=Number((numerator+500000n)/1000000n);
  return {
    estimatedCostMicrousd:rounded,
    pricingStatus:missing?'partial':'priced',
    pricingRuleId:rule.id
  };
}
