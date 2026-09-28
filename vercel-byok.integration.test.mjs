import test from 'node:test';
import assert from 'node:assert/strict';

function request({method='POST',route,body={}}){
  return {method,query:{route},body,headers:{host:'demo.vercel.app'}};
}
function response(){
  return {
    statusCode:200,body:null,headers:{},
    status(code){this.statusCode=code;return this;},
    setHeader(name,value){this.headers[name]=value;},
    json(value){this.body=value;return value;}
  };
}
function fakeFetchResponse(status,data){
  return {
    ok:status>=200&&status<300,
    status,
    async text(){return JSON.stringify(data);}
  };
}

test('Vercel BYOK connection test validates user Groq key and selected model without persisting it',async()=>{
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    calls.push({url,options});
    return fakeFetchResponse(200,{data:[{id:'openai/gpt-oss-120b'}]});
  };
  try{
    const handler=(await import('./api/demo.js')).default;
    const res=response();
    await handler(request({
      route:'groq-test',
      body:{provider:'groq',apiKey:'user-owned-test-key-1234',model:'openai/gpt-oss-120b'}
    }),res);

    assert.equal(res.statusCode,200);
    assert.deepEqual(res.body,{ok:true,provider:'groq',model:'openai/gpt-oss-120b',modelAvailable:true});
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://api.groq.com/openai/v1/models');
    assert.equal(calls[0].options.headers.Authorization,'Bearer user-owned-test-key-1234');
    assert.equal(JSON.stringify(res.body).includes('user-owned-test-key-1234'),false);
  }finally{
    globalThis.fetch=original;
  }
});

test('Vercel BYOK live Patient Coach and Evaluator calls use Groq while keeping demo response contracts',async()=>{
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):{};
    calls.push({url,options,body});
    if(body.response_format?.type==='json_object'){
      return fakeFetchResponse(200,{
        id:'groq-coach-1',
        choices:[{message:{content:JSON.stringify({nextHint:'請追問症狀開始的時間。',reflectionPrompt:'這一題要釐清哪一類資訊？'})}}],
        usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}
      });
    }
    if(body.response_format?.type==='json_schema'){
      return fakeFetchResponse(200,{
        id:'groq-eval-1',
        choices:[{message:{content:JSON.stringify({
          totalScore:999,maxScore:999,percentage:999,
          items:[{
            id:'history',criterion:'詢問重要神經／中風病史',status:'covered',score:15,maxScore:15,
            evidence:[{turn:2,quote:'以前有中風過嗎？'}],reasoning:'有直接詢問中風病史。'
          }],
          overall:{
            comment:'已詢問部分重要病史。',
            strengths:['有詢問中風病史'],
            improvements:['仍有其他面向待補充'],
            recommendations:['依固定問診架構繼續練習'],
            nextPracticeFocus:'病程與功能面向'
          }
        })}}],
        usage:{prompt_tokens:400,completion_tokens:150,total_tokens:550}
      });
    }
    return fakeFetchResponse(200,{
      id:'groq-patient-1',
      choices:[{message:{content:'有，兩年前曾經發生過左側腦中風。'}}],
      usage:{prompt_tokens:180,completion_tokens:18,total_tokens:198}
    });
  };

  try{
    const handler=(await import('./api/demo.js')).default;
    const byok={provider:'groq',apiKey:'user-owned-live-key-5678',model:'openai/gpt-oss-120b'};
    const transcript=[
      {role:'patient',content:'你好。嗯……我最近講話有點、不太順。'},
      {role:'student',content:'以前有中風過嗎？'}
    ];

    const chatRes=response();
    await handler(request({
      route:'chat',
      body:{caseId:'aphasia_001',message:'以前有中風過嗎？',transcript,revealedFactIds:[],mode:'training',demoByok:byok}
    }),chatRes);
    assert.equal(chatRes.statusCode,200);
    assert.equal(chatRes.body.provider,'groq');
    assert.equal(chatRes.body.model,'openai/gpt-oss-120b');
    assert.match(chatRes.body.reply,/中風/);
    assert.equal(chatRes.body.revealedFactIds.includes('stroke_history'),true);
    assert.equal('apiKey' in chatRes.body,false);

    const coachRes=response();
    await handler(request({
      route:'coach',
      body:{caseId:'aphasia_001',transcript,revealedFactIds:['stroke_history'],mode:'training',demoByok:byok}
    }),coachRes);
    assert.equal(coachRes.statusCode,200);
    assert.equal(coachRes.body.provider,'groq');
    assert.match(coachRes.body.nextHint,/時間/);
    assert.equal(typeof coachRes.body.progress.total,'number');

    const evalRes=response();
    await handler(request({
      route:'evaluate',
      body:{caseId:'aphasia_001',transcript,revealedFactIds:['stroke_history'],mode:'exam',demoByok:byok}
    }),evalRes);
    assert.equal(evalRes.statusCode,200);
    assert.equal(evalRes.body.provider,'groq');
    assert.equal(evalRes.body.judgeVersion,'vercel-byok-v1');
    assert.equal(evalRes.body.items.length,9);
    assert.equal(evalRes.body.totalScore,15);
    assert.equal(evalRes.body.maxScore,100);
    assert.equal(evalRes.body.percentage,15);
    assert.equal(JSON.stringify(evalRes.body).includes('user-owned-live-key-5678'),false);

    assert.equal(calls.length,3);
    assert.equal(calls.every(call=>call.url==='https://api.groq.com/openai/v1/chat/completions'),true);
    assert.equal(calls.every(call=>call.options.headers.Authorization==='Bearer user-owned-live-key-5678'),true);
    assert.match(calls[0].body.messages[0].content,/simulated patient/);
    assert.equal(calls[2].body.response_format.type,'json_schema');
    assert.equal(calls[2].body.response_format.json_schema.strict,true);
  }finally{
    globalThis.fetch=original;
  }
});

test('Vercel BYOK upstream errors are sanitized and never echo the API key or upstream body',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>fakeFetchResponse(401,{error:{message:'upstream secret detail'}});
  try{
    const handler=(await import('./api/demo.js')).default;
    const res=response();
    await handler(request({
      route:'groq-test',
      body:{provider:'groq',apiKey:'should-never-echo-9999',model:'openai/gpt-oss-120b'}
    }),res);
    assert.equal(res.statusCode,401);
    assert.deepEqual(res.body,{error:'GROQ_AUTHENTICATION_FAILED'});
    assert.equal(JSON.stringify(res.body).includes('should-never-echo-9999'),false);
    assert.equal(JSON.stringify(res.body).includes('upstream secret detail'),false);
  }finally{
    globalThis.fetch=original;
  }
});
