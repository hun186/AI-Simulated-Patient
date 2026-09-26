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
