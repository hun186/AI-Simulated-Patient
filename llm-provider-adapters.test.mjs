import test from 'node:test';
import assert from 'node:assert/strict';

function fakeResponse({status=200,json={},headers={}}={}){
  return {
    ok:status>=200&&status<300,
    status,
    headers:{get:name=>headers[String(name).toLowerCase()]??null},
    async json(){return json;},
    async text(){return JSON.stringify(json);}
  };
}

async function gateway(){
  return import('./lib/llm/provider-gateway.js');
}

test('OpenAI preset uses Responses API and normalizes text and usage',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return fakeResponse({
      json:{
        id:'resp_123',
        output_text:'patient answer',
        usage:{
          input_tokens:120,
          input_tokens_details:{cached_tokens:30,cache_write_tokens:10},
          output_tokens:20,
          output_tokens_details:{reasoning_tokens:5},
          total_tokens:140
        },
        service_tier:'default'
      },
      headers:{'x-request-id':'req_header'}
    });
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{providerKind:'openai',preset:'openai',apiKey:'sk-test',defaultModel:'gpt-test'},
    systemPrompt:'You are the patient.',
    messages:[{role:'user',content:'hello'}],
    maxOutputTokens:111,
    safetyIdentifier:'opaque-user'
  },{fetchImpl});

  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
  assert.equal(calls[0].options.headers.Authorization,'Bearer sk-test');
  assert.equal(calls[0].body.instructions,'You are the patient.');
  assert.equal(calls[0].body.model,'gpt-test');
  assert.equal(calls[0].body.max_output_tokens,111);
  assert.equal(calls[0].body.safety_identifier,'opaque-user');
  assert.equal(calls[0].body.service_tier,'default');
  assert.deepEqual(calls[0].body.input,[{role:'user',content:'hello'}]);
  assert.equal(result.text,'patient answer');
  assert.equal(result.provider,'openai');
  assert.equal(result.preset,'openai');
  assert.equal(result.model,'gpt-test');
  assert.deepEqual(result.usage,{
    inputTokens:120,cachedInputTokens:30,cacheWriteTokens:10,outputTokens:20,reasoningTokens:5,totalTokens:140
  });
  assert.equal(result.serviceTier,'default');
  assert.equal(result.providerRequestId,'resp_123');
});

test('DeepSeek preset uses fixed OpenAI-compatible Chat Completions endpoint',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      id:'ds_1',model:'deepseek-flash',
      choices:[{message:{role:'assistant',content:'deepseek answer'}}],
      usage:{
        prompt_tokens:90,prompt_cache_hit_tokens:40,completion_tokens:10,total_tokens:100,
        completion_tokens_details:{reasoning_tokens:3}
      }
    }});
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{
      providerKind:'openai_compatible',preset:'deepseek',
      baseUrl:'https://malicious.example/v1',apiKey:'ds-key',defaultModel:'deepseek-flash'
    },
    systemPrompt:'system',
    messages:[{role:'user',content:'question'}]
  },{fetchImpl});

  assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].options.headers.Authorization,'Bearer ds-key');
  assert.deepEqual(calls[0].body.messages,[
    {role:'system',content:'system'},{role:'user',content:'question'}
  ]);
  assert.equal(result.text,'deepseek answer');
  assert.deepEqual(result.usage,{
    inputTokens:90,cachedInputTokens:40,outputTokens:10,reasoningTokens:3,totalTokens:100
  });
});

test('Ollama preset is keyless by default and uses local OpenAI-compatible endpoint',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      id:'ollama_1',model:'qwen-local',
      choices:[{message:{role:'assistant',content:'local answer'}}],
      usage:{prompt_tokens:11,completion_tokens:4,total_tokens:15}
    }});
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{providerKind:'openai_compatible',preset:'ollama',baseUrl:'',apiKey:'',defaultModel:'qwen-local'},
    systemPrompt:'patient',messages:[{role:'user',content:'hi'}]
  },{fetchImpl});

  assert.equal(calls[0].url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal('Authorization' in calls[0].options.headers,false);
  assert.equal(result.text,'local answer');
});

test('custom compatible base URL is joined without duplicate slashes',async()=>{
  const calls=[];
  const fetchImpl=async(url)=>{
    calls.push(url);
    return fakeResponse({json:{
      id:'custom_1',choices:[{message:{content:'ok'}}],
      usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}
    }});
  };
  const {generateLlm}=await gateway();
  await generateLlm({
    connection:{providerKind:'openai_compatible',preset:'custom',baseUrl:'https://llm.example/v1///',apiKey:'x',defaultModel:'m'},
    messages:[{role:'user',content:'hi'}]
  },{fetchImpl});
  assert.equal(calls[0],'https://llm.example/v1/chat/completions');
});

test('provider failures map to sanitized internal error codes',async()=>{
  const {generateLlm}=await gateway();
  const base={
    connection:{providerKind:'openai_compatible',preset:'custom',baseUrl:'https://llm.example/v1',apiKey:'secret',defaultModel:'m'},
    messages:[{role:'user',content:'hi'}]
  };
  const cases=[
    [400,'invalid_request'],
    [401,'authentication_failed'],
    [402,'insufficient_balance'],
    [403,'authentication_failed'],
    [404,'model_not_found'],
    [422,'invalid_request'],
    [429,'rate_limited'],
    [500,'endpoint_unreachable']
  ];
  for(const [status,code] of cases){
    await assert.rejects(
      ()=>generateLlm(base,{fetchImpl:async()=>fakeResponse({status,json:{error:{message:'UPSTREAM SECRET BODY'}}})}),
      error=>{
        assert.equal(error.code,code);
        assert.equal(error.message.includes('UPSTREAM SECRET BODY'),false);
        return true;
      }
    );
  }

  await assert.rejects(
    ()=>generateLlm(base,{fetchImpl:async()=>{throw new TypeError('connect ECONNREFUSED 10.0.0.5');}}),
    error=>error.code==='endpoint_unreachable' && !error.message.includes('10.0.0.5')
  );

  await assert.rejects(
    ()=>generateLlm(base,{fetchImpl:async()=>fakeResponse({json:{choices:[]}})}),
    error=>error.code==='invalid_response'
  );
});

test('provider timeout is normalized without leaking internals',async()=>{
  const {generateLlm}=await gateway();
  const request={
    connection:{providerKind:'openai_compatible',preset:'custom',baseUrl:'https://llm.example/v1',apiKey:'x',defaultModel:'m'},
    messages:[{role:'user',content:'hi'}],
    timeoutMs:5
  };
  const fetchImpl=(_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{
      const error=new Error('sensitive timeout target');
      error.name='AbortError';
      reject(error);
    },{once:true});
  });
  await assert.rejects(
    ()=>generateLlm(request,{fetchImpl}),
    error=>error.code==='timeout' && !error.message.includes('sensitive')
  );
});

test('DeepSeek connection probe disables default thinking so a tiny probe reaches final content',async()=>{
  const calls=[];
  const {testLlmConnection}=await gateway();
  const fetchImpl=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      id:'ds_probe',model:'deepseek-flash',
      choices:[{message:{content:'OK'}}],
      usage:{prompt_tokens:4,completion_tokens:1,total_tokens:5}
    }});
  };
  const result=await testLlmConnection({
    providerKind:'openai_compatible',preset:'deepseek',baseUrl:'https://api.deepseek.com',
    apiKey:'ds-test',defaultModel:'deepseek-flash'
  },{fetchImpl});
  assert.equal(result.ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
  assert.deepEqual(calls[0].body.thinking,{type:'disabled'});
  assert.equal(calls[0].body.max_tokens,32);
});

test('testLlmConnection returns a sanitized success summary',async()=>{
  const {testLlmConnection}=await gateway();
  const fetchImpl=async()=>fakeResponse({json:{
    id:'check_1',choices:[{message:{content:'OK'}}],
    usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}
  }});
  const result=await testLlmConnection({
    providerKind:'openai_compatible',preset:'ollama',baseUrl:'http://127.0.0.1:11434/v1',
    apiKey:'',defaultModel:'qwen-local'
  },{fetchImpl});
  assert.equal(result.ok,true);
  assert.equal(result.provider,'openai_compatible');
  assert.equal(result.preset,'ollama');
  assert.equal(result.model,'qwen-local');
  assert.equal(typeof result.latencyMs,'number');
  assert.deepEqual(Object.keys(result).sort(),['latencyMs','model','ok','preset','provider'].sort());
});
