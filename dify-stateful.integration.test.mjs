import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Dify stateful Chatflow persists conversation_id per interview and reuses it for final trigger',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-dify-stateful-'));
  const dbPath=join(dir,'aisp.sqlite');
  const key=Buffer.alloc(32,9).toString('base64');

  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.APP_ENV='production';
    process.env.LLM_SECRET_MASTER_KEY=${JSON.stringify(key)};
    process.env.AUTH_ALLOWED_ORIGINS='http://localhost';

    const http=await import('node:http');
    const calls=[];
    const evaluation={
      totalScore:14,maxScore:14,percentage:100,
      items:[{
        id:'H01',criterion:'主訴',status:'covered',score:1,maxScore:1,
        evidence:[{turn:2,quote:'第一題'}],reasoning:'covered'
      }],
      overall:{
        comment:'完成',strengths:['有詢問主訴'],improvements:[],
        recommendations:['繼續保持'],nextPracticeFocus:'維持結構化問診'
      }
    };

    let sequence=0;
    const dify=http.createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw||'{}');
      calls.push({url:req.url,body});
      sequence+=1;
      const conversationId=body.conversation_id||('conv-'+sequence);
      const answer=body.query==='問診結束'
        ?JSON.stringify(evaluation)
        :'病人回答：'+body.query;
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({
        message_id:'msg-'+sequence,
        conversation_id:conversationId,
        answer,
        metadata:{usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}
      }));
    });
    await new Promise(resolve=>dify.listen(0,'127.0.0.1',resolve));
    const baseUrl='http://127.0.0.1:'+dify.address().port+'/v1';

    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const {createConnection}=await import('./lib/llm/connections.js');
    const {setSystemRoute}=await import('./lib/llm/routes.js');
    const sessionsHandler=(await import('./api/sessions.js')).default;
    const chatHandler=(await import('./api/chat.js')).default;
    const evaluateHandler=(await import('./api/evaluate.js')).default;

    function response(){return {
      statusCode:200,body:null,headers:{},
      status(c){this.statusCode=c;return this;},
      setHeader(n,v){this.headers[n]=v;},
      json(v){this.body=v;return v;},
      end(v=''){this.body=v;return v;}
    };}
    function request(body,auth){return {
      method:'POST',body,
      headers:{
        origin:'http://localhost',host:'localhost','user-agent':'dify-stateful-test',
        ...(auth?{cookie:'aisp_session='+encodeURIComponent(auth.token),'x-csrf-token':auth.csrfToken}:{})
      },
      socket:{remoteAddress:'127.0.0.1'}
    };}

    const admin=await createUser({
      email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'
    });
    const student=await createUser({
      email:'student@example.com',password:'StudentPass!2026',displayName:'Student',role:'student'
    });
    const auth=await loginUser({
      email:'student@example.com',password:'StudentPass!2026',req:request({},null)
    });

    const connection=await createConnection(admin,{
      name:'Stateful Dify',preset:'dify',baseUrl,defaultModel:'chat',apiKey:'app-test-key'
    });
    await setSystemRoute(admin,{
      agentType:'patient',connectionId:connection.id,
      config:{difyExecutionMode:'stateful_chatflow'}
    });
    await setSystemRoute(admin,{
      agentType:'evaluator',connectionId:connection.id,
      config:{
        difyExecutionMode:'stateful_chatflow',
        difyFinalTriggerEnabled:true,
        difyFinalTrigger:'問診結束'
      }
    });

    const createRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createRes);
    const sessionId=createRes.body.session.id;

    const firstRes=response();
    await chatHandler(request({sessionId,message:'第一題'},auth),firstRes);
    const firstState=(await query(
      'select state_json from llm_provider_session_state where session_id=$1 and connection_id=$2',
      [sessionId,connection.id]
    ))[0];

    const secondRes=response();
    await chatHandler(request({sessionId,message:'第二題'},auth),secondRes);

    const evalRes=response();
    await evaluateHandler(request({sessionId},auth),evalRes);
    const finalStatus=(await query('select status from interview_sessions where id=$1',[sessionId]))[0].status;
    const evalRows=await query('select result_json from evaluations where session_id=$1',[sessionId]);

    const createSecondRes=response();
    await sessionsHandler(request({caseId:'aphasia_001',mode:'training',coachEnabled:false},auth),createSecondRes);
    const secondSessionId=createSecondRes.body.session.id;
    const thirdRes=response();
    await chatHandler(request({sessionId:secondSessionId,message:'新場次第一題'},auth),thirdRes);

    console.log(JSON.stringify({
      connectionId:connection.id,
      sessionId,secondSessionId,
      first:{status:firstRes.statusCode,body:firstRes.body,state:firstState},
      second:{status:secondRes.statusCode,body:secondRes.body},
      evaluation:{status:evalRes.statusCode,body:evalRes.body,sessionStatus:finalStatus,rows:evalRows.length},
      third:{status:thirdRes.statusCode,body:thirdRes.body},
      calls
    }));
    await new Promise(resolve=>dify.close(resolve));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,APP_ENV:'production',LLM_SECRET_MASTER_KEY:key},
    encoding:'utf8',
    timeout:30000
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));

    assert.equal(data.first.status,200);
    assert.equal(data.first.body.reply,'病人回答：第一題');
    assert.deepEqual(JSON.parse(data.first.state.state_json),{conversationId:'conv-1'});

    assert.equal(data.second.status,200);
    assert.equal(data.evaluation.status,200);
    assert.equal(data.evaluation.body.totalScore,14);
    assert.equal(data.evaluation.sessionStatus,'completed');
    assert.equal(data.evaluation.rows,1);

    assert.equal(data.calls.length,4);
    assert.equal(data.calls[0].url,'/v1/chat-messages');
    assert.equal(data.calls[0].body.query,'第一題');
    assert.equal(data.calls[0].body.conversation_id,'');
    assert.equal(data.calls[1].body.query,'第二題');
    assert.equal(data.calls[1].body.conversation_id,'conv-1');
    assert.equal(data.calls[2].body.query,'問診結束');
    assert.equal(data.calls[2].body.conversation_id,'conv-1');

    assert.equal(data.third.status,200);
    assert.equal(data.calls[3].body.query,'新場次第一題');
    assert.equal(data.calls[3].body.conversation_id,'');
    assert.notEqual(data.sessionId,data.secondSessionId);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
