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
    inputTokens:120,cachedInputTokens:30,cacheMissTokens:90,cacheReadStatus:'reported',cacheWriteTokens:10,outputTokens:20,reasoningTokens:5,totalTokens:140
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
    inputTokens:90,cachedInputTokens:40,cacheMissTokens:50,cacheReadStatus:'reported',outputTokens:10,reasoningTokens:3,totalTokens:100
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

test('Ollama Cloud uses hosted OpenAI-compatible endpoint with bearer API key',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      id:'oc_1',model:'deepseek-v4-pro',
      choices:[{message:{content:'cloud answer'}}],
      usage:{prompt_tokens:100,prompt_tokens_details:{cached_tokens:25},completion_tokens:20,total_tokens:120}
    }});
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{providerKind:'openai_compatible',preset:'ollama',baseUrl:'https://ollama.com/v1',apiKey:'ollama-secret',defaultModel:'deepseek-v4-pro'},
    messages:[{role:'user',content:'hi'}]
  },{fetchImpl});
  assert.equal(calls[0].url,'https://ollama.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization,'Bearer ollama-secret');
  assert.equal(result.text,'cloud answer');
  assert.equal(result.usage.cachedInputTokens,25);
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


test('Dify Chat/Chatflow uses blocking chat-messages and normalizes answer/usage',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      message_id:'dify-msg-1',
      answer:'Dify patient answer',
      metadata:{usage:{prompt_tokens:21,completion_tokens:7,total_tokens:28}}
    }});
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',apiKey:'app-secret',defaultModel:'chat'},
    model:'chat',
    systemPrompt:'Stay in character.',
    messages:[{role:'user',content:'你好'}],
    safetyIdentifier:'opaque-user',
    providerConfig:{difyInputs:{language:'zh-TW'}}
  },{fetchImpl});

  assert.equal(calls[0].url,'https://api.dify.ai/v1/chat-messages');
  assert.equal(calls[0].options.headers.Authorization,'Bearer app-secret');
  assert.equal(calls[0].body.response_mode,'blocking');
  assert.equal(calls[0].body.user,'opaque-user');
  assert.equal(calls[0].body.conversation_id,'');
  assert.deepEqual(calls[0].body.inputs,{language:'zh-TW'});
  assert.match(calls[0].body.query,/SYSTEM INSTRUCTIONS:/);
  assert.match(calls[0].body.query,/Stay in character/);
  assert.match(calls[0].body.query,/你好/);
  assert.equal(result.text,'Dify patient answer');
  assert.equal(result.provider,'dify');
  assert.equal(result.preset,'dify');
  assert.equal(result.model,'chat');
  assert.deepEqual(result.usage,{
    inputTokens:21,cachedInputTokens:0,cacheMissTokens:0,cacheReadStatus:'unreported',outputTokens:7,reasoningTokens:0,totalTokens:28
  });
  assert.equal(result.providerRequestId,'dify-msg-1');
});

test('Dify Workflow maps combined prompt to configured input/output keys',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return fakeResponse({json:{
      workflow_run_id:'wf-run-1',
      task_id:'task-1',
      data:{status:'succeeded',outputs:{result_text:'workflow answer'},total_tokens:44}
    }});
  };
  const {generateLlm}=await gateway();
  const result=await generateLlm({
    connection:{providerKind:'dify',preset:'dify',baseUrl:'https://dify.internal/v1',apiKey:'app-secret',defaultModel:'workflow'},
    model:'workflow',
    systemPrompt:'Evaluator rules',
    messages:[{role:'user',content:'Evaluate transcript'}],
    providerConfig:{
      difyInputKey:'agent_prompt',
      difyOutputKey:'result_text',
      difyInputs:{locale:'zh-TW'}
    },
    safetyIdentifier:'user-1'
  },{fetchImpl});

  assert.equal(calls[0].url,'https://dify.internal/v1/workflows/run');
  assert.equal(calls[0].body.response_mode,'blocking');
  assert.equal(calls[0].body.user,'user-1');
  assert.equal(calls[0].body.inputs.locale,'zh-TW');
  assert.match(calls[0].body.inputs.agent_prompt,/Evaluator rules/);
  assert.equal(result.text,'workflow answer');
  assert.equal(result.usage.totalTokens,44);
  assert.equal(result.providerRequestId,'wf-run-1');
});

test('Dify connection test uses app parameters endpoint without invoking the app',async()=>{
  const calls=[];
  const {testLlmConnection}=await gateway();
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return fakeResponse({json:{user_input_form:[]}});
  };
  const result=await testLlmConnection({
    providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',
    apiKey:'app-key',defaultModel:'chat'
  },{fetchImpl});
  assert.equal(result.ok,true);
  assert.equal(result.provider,'dify');
  assert.equal(result.preset,'dify');
  assert.equal(result.model,'chat');
  assert.equal(calls[0].url,'https://api.dify.ai/v1/parameters?user=aisp-connection-test');
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.headers.Authorization,'Bearer app-key');
});


test('Dify Stateful Chatflow creates and then reuses conversation_id while sending only the current query',async()=>{
  const calls=[];
  let n=0;
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);
    calls.push({url,body});
    n+=1;
    return fakeResponse({json:{
      message_id:'msg-'+n,
      conversation_id:'conv-123',
      answer:n===1?'first reply':'second reply',
      metadata:{usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}
    }});
  };
  const {generateLlm}=await gateway();
  const base={
    connection:{providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',apiKey:'app-key',defaultModel:'chat'},
    model:'chat',
    systemPrompt:'LOCKED SYSTEM PROMPT SHOULD NOT BE SENT AS QUERY IN STATEFUL MODE',
    providerConfig:{difyExecutionMode:'stateful_chatflow'},
    safetyIdentifier:'opaque-user'
  };

  const first=await generateLlm({
    ...base,
    messages:[
      {role:'assistant',content:'old patient reply'},
      {role:'user',content:'第一題'}
    ]
  },{fetchImpl});

  const second=await generateLlm({
    ...base,
    providerState:first.providerState,
    messages:[
      {role:'assistant',content:'old patient reply'},
      {role:'user',content:'第二題'}
    ]
  },{fetchImpl});

  assert.equal(calls[0].url,'https://api.dify.ai/v1/chat-messages');
  assert.equal(calls[0].body.query,'第一題');
  assert.equal(calls[0].body.conversation_id,'');
  assert.equal(calls[1].body.query,'第二題');
  assert.equal(calls[1].body.conversation_id,'conv-123');
  assert.deepEqual(first.providerState,{conversationId:'conv-123'});
  assert.deepEqual(second.providerState,{conversationId:'conv-123'});
});

test('Dify Stateful Chatflow can require an existing conversation for final-trigger calls',async()=>{
  const {generateLlm}=await gateway();
  await assert.rejects(
    ()=>generateLlm({
      connection:{providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',apiKey:'app-key',defaultModel:'chat'},
      model:'chat',
      messages:[{role:'user',content:'問診結束'}],
      providerConfig:{difyExecutionMode:'stateful_chatflow'},
      requireProviderState:true
    },{fetchImpl:async()=>fakeResponse({json:{}})}),
    error=>error.code==='dify_conversation_state_missing'
  );
});

test('Dify Stateful mode rejects Workflow because conversation_id is a Chatflow contract',async()=>{
  const {generateLlm}=await gateway();
  await assert.rejects(
    ()=>generateLlm({
      connection:{providerKind:'dify',preset:'dify',baseUrl:'https://api.dify.ai/v1',apiKey:'app-key',defaultModel:'workflow'},
      model:'workflow',
      messages:[{role:'user',content:'hello'}],
      providerConfig:{difyExecutionMode:'stateful_chatflow'}
    },{fetchImpl:async()=>fakeResponse({json:{}})}),
    error=>error.code==='invalid_request'
  );
});
