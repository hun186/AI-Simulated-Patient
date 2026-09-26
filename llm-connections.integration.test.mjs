import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('LLM connection management encrypts secrets and enforces Admin/Teacher scopes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aisp-llm-connections-'));
  const dbPath=join(dir,'aisp.sqlite');
  const keyPath=join(dir,'llm-secret.key');
  const script=`
    process.env.DB_DRIVER='sqlite';
    process.env.SQLITE_PATH=${JSON.stringify(dbPath)};
    process.env.LLM_SECRET_KEY_PATH=${JSON.stringify(keyPath)};
    process.env.APP_ENV='development';

    const http=await import('node:http');
    const {query}=await import('./lib/db.js');
    const {createUser,loginUser}=await import('./lib/server-auth.js');
    const handler=(await import('./api/teacher/ai-settings.js')).default;

    function request(method='POST',body={},auth=null){
      const headers={origin:'http://localhost',host:'localhost','user-agent':'llm-connection-test'};
      if(auth){
        headers.cookie='aisp_session='+encodeURIComponent(auth.token);
        headers['x-csrf-token']=auth.csrfToken;
      }
      return {method,body,query:{},headers,socket:{remoteAddress:'127.0.0.1'}};
    }
    function response(){
      return {
        statusCode:200,headers:{},body:null,
        status(code){this.statusCode=code;return this;},
        setHeader(name,value){this.headers[name]=value;},
        json(data){this.body=data;return data;},
        end(data=''){this.body=data;return data;}
      };
    }
    async function call(method,body,auth){
      const res=response();
      await handler(request(method,body,auth),res);
      return res;
    }

    const admin=await createUser({email:'admin@example.com',password:'AdminPass!2026',displayName:'Admin',role:'admin'});
    const teacher1=await createUser({email:'t1@example.com',password:'TeacherPass!2026',displayName:'Teacher 1',role:'teacher'});
    const teacher2=await createUser({email:'t2@example.com',password:'TeacherPass!2026',displayName:'Teacher 2',role:'teacher'});
    const adminAuth=await loginUser({email:admin.email,password:'AdminPass!2026',req:request()});
    const t1Auth=await loginUser({email:teacher1.email,password:'TeacherPass!2026',req:request()});
    const t2Auth=await loginUser({email:teacher2.email,password:'TeacherPass!2026',req:request()});

    const noCsrfReq=request('POST',{
      action:'createConnection',name:'No CSRF',preset:'openai',defaultModel:'gpt-x',apiKey:'sk-nope'
    },adminAuth);
    delete noCsrfReq.headers['x-csrf-token'];
    const noCsrfRes=response();
    await handler(noCsrfReq,noCsrfRes);

    const adminCreate=await call('POST',{
      action:'createConnection',name:'System OpenAI',preset:'openai',
      defaultModel:'gpt-system',apiKey:'sk-admin-plain-1234'
    },adminAuth);
    const systemId=adminCreate.body.connection.id;

    const storedSystem=(await query('select * from llm_provider_connections where id=$1',[systemId]))[0];

    const teacherCreate=await call('POST',{
      action:'createConnection',name:'My DeepSeek',preset:'deepseek',
      defaultModel:'deepseek-flash',apiKey:'ds-teacher-secret-5678'
    },t1Auth);
    const teacherConnectionId=teacherCreate.body.connection.id;

    const teacher2Create=await call('POST',{
      action:'createConnection',name:'Other Teacher OpenAI',preset:'openai',
      defaultModel:'gpt-other',apiKey:'sk-other-teacher-2222'
    },t2Auth);

    const teacherCustom=await call('POST',{
      action:'createConnection',name:'Forbidden LAN',preset:'custom',
      baseUrl:'http://127.0.0.1:9999/v1',defaultModel:'local',apiKey:'x'
    },t1Auth);

    const teacherList=await call('GET',{},t1Auth);
    const teacherIds=teacherList.body.connections.map(x=>x.id);
    const leakedFields=teacherList.body.connections.flatMap(x=>Object.keys(x)).filter(k=>[
      'encryptedApiKey','encrypted_api_key','apiKeyIv','api_key_iv','apiKeyTag','api_key_tag','apiKey'
    ].includes(k));

    const beforeUpdate=(await query('select encrypted_api_key,api_key_last4 from llm_provider_connections where id=$1',[teacherConnectionId]))[0];
    const updateKey=await call('POST',{
      action:'updateConnection',connectionId:teacherConnectionId,
      name:'My DeepSeek Updated',defaultModel:'deepseek-flash',apiKey:'ds-new-secret-9999'
    },t1Auth);
    const afterKeyUpdate=(await query('select encrypted_api_key,api_key_last4 from llm_provider_connections where id=$1',[teacherConnectionId]))[0];

    const updateNoKey=await call('POST',{
      action:'updateConnection',connectionId:teacherConnectionId,
      name:'My DeepSeek Renamed',defaultModel:'deepseek-flash'
    },t1Auth);
    const afterNoKeyUpdate=(await query('select encrypted_api_key,api_key_last4 from llm_provider_connections where id=$1',[teacherConnectionId]))[0];

    const server=http.createServer((req,res)=>{
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({
        id:'local-test-request',
        model:'local-test-model',
        choices:[{message:{role:'assistant',content:'OK'}}],
        usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}
      }));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();
    const customCreate=await call('POST',{
      action:'createConnection',name:'Admin Local',preset:'custom',
      baseUrl:'http://127.0.0.1:'+address.port+'/v1',
      defaultModel:'local-test-model',apiKey:''
    },adminAuth);
    const testConnection=await call('POST',{
      action:'testConnection',connectionId:customCreate.body.connection.id
    },adminAuth);
    await new Promise(resolve=>server.close(resolve));

    const audits=await query(
      "select action,success from auth_audit_events where action like 'llm.connection.%' order by id asc"
    );

    console.log(JSON.stringify({
      noCsrf:{status:noCsrfRes.statusCode,body:noCsrfRes.body},
      adminCreate:{status:adminCreate.statusCode,connection:adminCreate.body.connection},
      systemStored:{
        ciphertext:storedSystem.encrypted_api_key,
        plaintextPresent:String(storedSystem.encrypted_api_key||'').includes('sk-admin-plain-1234'),
        last4:storedSystem.api_key_last4
      },
      teacherCreate:{status:teacherCreate.statusCode,connection:teacherCreate.body.connection},
      teacher2Id:teacher2Create.body.connection.id,
      teacherCustom:{status:teacherCustom.statusCode,body:teacherCustom.body},
      teacherList:{status:teacherList.statusCode,ids:teacherIds,leakedFields},
      updateKey:{status:updateKey.statusCode,before:beforeUpdate,after:afterKeyUpdate},
      updateNoKey:{status:updateNoKey.statusCode,after:afterNoKeyUpdate},
      customCreate:{status:customCreate.statusCode},
      testConnection:{status:testConnection.statusCode,body:testConnection.body},
      audits
    }));
  `;

  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:resolve('.'),
    env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:dbPath,LLM_SECRET_KEY_PATH:keyPath},
    encoding:'utf8',
    timeout:30000
  });

  try{
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(data.noCsrf.status,403);

    assert.equal(data.adminCreate.status,201);
    assert.equal(data.adminCreate.connection.scopeType,'system');
    assert.equal(data.adminCreate.connection.preset,'openai');
    assert.equal(data.adminCreate.connection.apiKeyLast4,'1234');
    assert.equal('apiKey' in data.adminCreate.connection,false);
    assert.equal('encryptedApiKey' in data.adminCreate.connection,false);
    assert.equal(data.systemStored.plaintextPresent,false);
    assert.equal(data.systemStored.last4,'1234');

    assert.equal(data.teacherCreate.status,201);
    assert.equal(data.teacherCreate.connection.scopeType,'teacher');
    assert.equal(data.teacherCreate.connection.preset,'deepseek');
    assert.equal(data.teacherCreate.connection.apiKeyLast4,'5678');
    assert.equal(data.teacherCustom.status,403);

    assert.equal(data.teacherList.status,200);
    assert.equal(data.teacherList.ids.includes(data.adminCreate.connection.id),true);
    assert.equal(data.teacherList.ids.includes(data.teacherCreate.connection.id),true);
    assert.equal(data.teacherList.ids.includes(data.teacher2Id),false);
    assert.deepEqual(data.teacherList.leakedFields,[]);

    assert.equal(data.updateKey.status,200);
    assert.notEqual(data.updateKey.before.encrypted_api_key,data.updateKey.after.encrypted_api_key);
    assert.equal(data.updateKey.after.api_key_last4,'9999');
    assert.equal(data.updateNoKey.status,200);
    assert.equal(data.updateNoKey.after.encrypted_api_key,data.updateKey.after.encrypted_api_key);
    assert.equal(data.updateNoKey.after.api_key_last4,'9999');

    assert.equal(data.customCreate.status,201);
    assert.equal(data.testConnection.status,200);
    assert.equal(data.testConnection.body.result.ok,true);
    assert.equal(data.testConnection.body.result.preset,'custom');
    assert.equal('text' in data.testConnection.body.result,false);

    assert.ok(data.audits.some(x=>x.action==='llm.connection.create' && Boolean(x.success)));
    assert.ok(data.audits.some(x=>x.action==='llm.connection.update' && Boolean(x.success)));
    assert.ok(data.audits.some(x=>x.action==='llm.connection.test' && Boolean(x.success)));
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
