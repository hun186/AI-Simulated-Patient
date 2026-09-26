import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(script,dbPath){
  return spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'test'},
    encoding:'utf8'
  });
}

test('pricing resolver prefers exact model over wildcard and snapshots cost without double-counting cached/reasoning tokens',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-pricing-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      const {query}=await import('./lib/db.js');
      const {resolvePricingRule,estimateUsageCost}=await import('./lib/llm/pricing.js');
      await query("insert into llm_pricing_rules (id,preset,model_pattern,input_microusd_per_million,cached_input_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        ['wild','openai','gpt-*',1000000,500000,2000000,3000000,'2026-01-01T00:00:00Z']);
      await query("insert into llm_pricing_rules (id,preset,model_pattern,input_microusd_per_million,cached_input_microusd_per_million,output_microusd_per_million,reasoning_microusd_per_million,effective_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        ['exact','openai','gpt-test',2000000,1000000,4000000,6000000,'2026-01-02T00:00:00Z']);
      const rule=await resolvePricingRule({preset:'openai',model:'gpt-test',at:'2026-09-26T00:00:00Z'});
      const priced=estimateUsageCost({
        usage:{inputTokens:1000,cachedInputTokens:400,outputTokens:500,reasoningTokens:100},
        usageStatus:'reported',rule
      });
      console.log(JSON.stringify({rule,priced}));
    `;
    const result=run(script,dbPath);
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.rule.id,'exact');
    // input: 600*2 + cached:400*1 + output:400*4 + reasoning:100*6 = 3800 micro-USD
    assert.deepEqual(data.priced,{estimatedCostMicrousd:3800,pricingStatus:'priced',pricingRuleId:'exact'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('unknown pricing stays unpriced and partial rules are explicitly partial',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-pricing-partial-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      const {query}=await import('./lib/db.js');
      const {resolvePricingRule,estimateUsageCost}=await import('./lib/llm/pricing.js');
      await query("insert into llm_pricing_rules (id,preset,model_pattern,input_microusd_per_million,effective_at) values ($1,$2,$3,$4,$5)",
        ['partial','deepseek','deepseek-*',1000000,'2026-01-01T00:00:00Z']);
      const missing=await resolvePricingRule({preset:'openai',model:'unknown',at:'2026-09-26T00:00:00Z'});
      const unpriced=estimateUsageCost({usage:{inputTokens:100,totalTokens:100},usageStatus:'reported',rule:missing});
      const rule=await resolvePricingRule({preset:'deepseek',model:'deepseek-chat',at:'2026-09-26T00:00:00Z'});
      const partial=estimateUsageCost({usage:{inputTokens:100,outputTokens:100,totalTokens:200},usageStatus:'reported',rule});
      console.log(JSON.stringify({unpriced,partial}));
    `;
    const result=run(script,dbPath);
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(data.unpriced,{estimatedCostMicrousd:null,pricingStatus:'unpriced',pricingRuleId:null});
    assert.equal(data.partial.pricingStatus,'partial');
    assert.equal(data.partial.estimatedCostMicrousd,100);
    assert.equal(data.partial.pricingRuleId,'partial');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('recordLlmUsage persists pricing snapshot and leaves unreported usage unpriced',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-pricing-record-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      const {query}=await import('./lib/db.js');
      const {recordLlmUsage}=await import('./lib/llm/usage.js');
      await query("insert into llm_pricing_rules (id,preset,model_pattern,input_microusd_per_million,output_microusd_per_million,effective_at) values ($1,$2,$3,$4,$5,$6)",
        ['rule1','openai','gpt-test',1000000,2000000,'2026-01-01T00:00:00Z']);
      await recordLlmUsage({
        userId:null,sessionId:null,caseId:null,agentType:'patient',
        route:{connectionId:null,providerKind:'openai',preset:'openai',model:'gpt-test'},
        result:{model:'gpt-test',preset:'openai',usageStatus:'reported',usage:{inputTokens:1000,outputTokens:500,totalTokens:1500},latencyMs:5}
      });
      await recordLlmUsage({
        userId:null,sessionId:null,caseId:null,agentType:'coach',
        route:{connectionId:null,providerKind:'openai',preset:'openai',model:'gpt-test'},
        result:{model:'gpt-test',preset:'openai',usageStatus:'unreported',usage:{},latencyMs:3}
      });
      const rows=await query('select agent_type,estimated_cost_microusd,pricing_status,pricing_rule_id from llm_usage_events order by id');
      console.log(JSON.stringify(rows));
    `;
    const result=run(script,dbPath);
    assert.equal(result.status,0,result.stderr);
    const rows=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(rows[0],{agent_type:'patient',estimated_cost_microusd:2000,pricing_status:'priced',pricing_rule_id:'rule1'});
    assert.deepEqual(rows[1],{agent_type:'coach',estimated_cost_microusd:null,pricing_status:'unpriced',pricing_rule_id:null});
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('DeepSeek pricing band follows Beijing weekday peak windows with exact boundaries',async()=>{
  const {deepseekPricingBand}=await import('./lib/llm/pricing.js');
  assert.equal(deepseekPricingBand('2026-09-28T00:59:59Z'),'off_peak'); // Mon 08:59:59 Beijing
  assert.equal(deepseekPricingBand('2026-09-28T01:00:00Z'),'peak');     // Mon 09:00
  assert.equal(deepseekPricingBand('2026-09-28T03:59:59Z'),'peak');     // Mon 11:59:59
  assert.equal(deepseekPricingBand('2026-09-28T04:00:00Z'),'off_peak'); // Mon 12:00
  assert.equal(deepseekPricingBand('2026-09-28T06:00:00Z'),'peak');     // Mon 14:00
  assert.equal(deepseekPricingBand('2026-09-28T09:59:59Z'),'peak');     // Mon 17:59:59
  assert.equal(deepseekPricingBand('2026-09-28T10:00:00Z'),'off_peak'); // Mon 18:00
  assert.equal(deepseekPricingBand('2026-10-03T02:00:00Z'),'off_peak'); // Sat 10:00
});

test('built-in DeepSeek Flash and V4 Pro rules price peak and off-peak usage accurately',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-pricing-deepseek-bands-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      const {resolvePricingRule,estimateUsageCost}=await import('./lib/llm/pricing.js');
      const usage={inputTokens:1000000,cachedInputTokens:250000,outputTokens:100000,reasoningTokens:20000,totalTokens:1100000};
      const flashPeak=await resolvePricingRule({preset:'deepseek',model:'deepseek-flash',at:'2026-09-28T01:30:00Z'});
      const flashOff=await resolvePricingRule({preset:'deepseek',model:'deepseek-flash',at:'2026-09-28T04:30:00Z'});
      const legacyFlash=await resolvePricingRule({preset:'deepseek',model:'deepseek-v4-flash-vision-exp',at:'2026-09-28T01:30:00Z'});
      const proPeak=await resolvePricingRule({preset:'deepseek',model:'deepseek-v4-pro',at:'2026-09-28T06:30:00Z'});
      const proOff=await resolvePricingRule({preset:'deepseek',model:'deepseek-v4-pro',at:'2026-09-27T06:30:00Z'});
      console.log(JSON.stringify({
        flashPeak,flashOff,legacyFlash,proPeak,proOff,
        flashPeakCost:estimateUsageCost({usage,usageStatus:'reported',rule:flashPeak}),
        flashOffCost:estimateUsageCost({usage,usageStatus:'reported',rule:flashOff})
      }));
    `;
    const result=run(script,dbPath);
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.flashPeak.timeBand,'peak');
    assert.equal(data.flashPeak.inputMicrousdPerMillion,300000);
    assert.equal(data.flashPeak.cachedInputMicrousdPerMillion,6000);
    assert.equal(data.flashPeak.outputMicrousdPerMillion,1200000);
    assert.equal(data.flashPeak.reasoningMicrousdPerMillion,1200000);

    assert.equal(data.flashOff.timeBand,'off_peak');
    assert.equal(data.flashOff.inputMicrousdPerMillion,150000);
    assert.equal(data.flashOff.cachedInputMicrousdPerMillion,3000);
    assert.equal(data.flashOff.outputMicrousdPerMillion,600000);

    assert.equal(data.legacyFlash.inputMicrousdPerMillion,300000);
    assert.equal(data.proPeak.inputMicrousdPerMillion,1320000);
    assert.equal(data.proPeak.cachedInputMicrousdPerMillion,44000);
    assert.equal(data.proPeak.outputMicrousdPerMillion,3960000);
    assert.equal(data.proOff.inputMicrousdPerMillion,660000);
    assert.equal(data.proOff.outputMicrousdPerMillion,1980000);

    assert.equal(data.flashPeakCost.estimatedCostMicrousd,346500);
    assert.equal(data.flashOffCost.estimatedCostMicrousd,173250);
    assert.equal(data.flashPeakCost.pricingStatus,'priced');
    assert.equal(data.flashOffCost.pricingStatus,'priced');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('recordLlmUsage snapshots DeepSeek pricing using the provider request start timestamp',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-pricing-deepseek-event-time-'));
  const dbPath=join(dir,'aisp.sqlite');
  try{
    const script=`
      const {query}=await import('./lib/db.js');
      const {recordLlmUsage}=await import('./lib/llm/usage.js');
      const route={connectionId:null,providerKind:'openai_compatible',preset:'deepseek',model:'deepseek-flash'};
      const result={model:'deepseek-flash',preset:'deepseek',usageStatus:'reported',
        usage:{inputTokens:1000000,cachedInputTokens:250000,outputTokens:100000,reasoningTokens:0,totalTokens:1100000},latencyMs:5};
      await recordLlmUsage({userId:null,sessionId:null,caseId:null,agentType:'patient',route,result,occurredAt:'2026-09-28T01:30:00Z'});
      await recordLlmUsage({userId:null,sessionId:null,caseId:null,agentType:'patient',route,result,occurredAt:'2026-09-28T04:30:00Z'});
      const rows=await query('select estimated_cost_microusd,pricing_status,pricing_rule_id,created_at from llm_usage_events order by id');
      console.log(JSON.stringify(rows));
    `;
    const result=run(script,dbPath);
    assert.equal(result.status,0,result.stderr);
    const rows=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(rows[0].estimated_cost_microusd,346500);
    assert.match(rows[0].pricing_rule_id,/peak/);
    assert.match(rows[0].created_at,/2026-09-28T01:30:00/);
    assert.equal(rows[1].estimated_cost_microusd,173250);
    assert.match(rows[1].pricing_rule_id,/offpeak/);
    assert.match(rows[1].created_at,/2026-09-28T04:30:00/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
