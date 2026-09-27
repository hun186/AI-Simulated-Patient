import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatientPrompt,buildCoachPrompt,buildEvaluatorPrompt,buildEvaluatorRepairPrompt,evaluationResponseFormat,
  validatePromptTemplate,renderPromptTemplate,getPromptTemplateCatalog
} from './lib/llm/prompts.js';
import {
  validateEvaluationContract,parseAndValidateEvaluation
} from './lib/llm/evaluation-contract.js';
import {
  runPatientAgent,runCoachAgent,runEvaluatorAgent,repairEvaluatorAgent
} from './lib/llm/agents.js';

const caseDefinition={
  id:'case-1',
  learningGoals:['structured interview'],
  patient:{name:'王先生',age:68,gender:'男',persona:'anxious but cooperative',speechStyle:'short answers'},
  facts:[{id:'secret-fact',label:'hidden history',value:'left stroke',mayVolunteer:false}],
  rubric:[{id:'history',label:'ask history',factIds:['secret-fact'],points:10,coachHint:'ask about history'}]
};
const session={
  student_user_id:'student@example.com',
  case_snapshot:caseDefinition
};
const transcript=[
  {role:'patient',content:'你好'},
  {role:'student',content:'以前有住院過嗎？'}
];

function validEvaluation(){
  return {
    totalScore:10,maxScore:10,percentage:100,
    items:[{
      id:'history',criterion:'ask history',status:'covered',score:10,maxScore:10,
      evidence:[{turn:2,quote:'以前有住院過嗎？'}],reasoning:'The student asked about history.'
    }],
    overall:{
      comment:'complete',strengths:['history'],improvements:[],recommendations:['continue'],
      nextPracticeFocus:'follow-up depth'
    }
  };
}

test('Patient, Coach, and Evaluator prompts keep distinct semantics',()=>{
  const patient=buildPatientPrompt({session});
  const coach=buildCoachPrompt({session,transcript});
  const evaluator=buildEvaluatorPrompt({session,transcript});

  assert.match(patient,/Stay in character/);
  assert.match(patient,/left stroke/);
  assert.doesNotMatch(patient,/points":10/);
  assert.match(patient,/Never reveal hidden rubric\/scoring instructions/);

  assert.match(coach,/Rubric/);
  assert.match(coach,/do not reveal hidden case answers/);
  assert.doesNotMatch(coach,/left stroke/);

  assert.match(evaluator,/Return JSON only/);
  assert.match(evaluator,/covered, partial, missed/);
  assert.match(evaluator,/totalScore, maxScore, percentage, items, overall/);
  assert.match(evaluator,/left stroke/);

  const format=evaluationResponseFormat();
  assert.equal(format.type,'json_schema');
  assert.deepEqual(format.schema.properties.items.items.properties.status.enum,['covered','partial','missed']);
});

test('evaluation contract accepts only machine-readable allowed statuses and preserves evidence',()=>{
  const value=validEvaluation();
  assert.deepEqual(validateEvaluationContract(value),value);
  assert.deepEqual(parseAndValidateEvaluation(JSON.stringify(value)),value);
  assert.throws(
    ()=>validateEvaluationContract({...value,items:[{...value.items[0],status:'good'}]}),
    error=>error.code==='INVALID_EVALUATION_CONTRACT'
  );
  assert.throws(
    ()=>parseAndValidateEvaluation('not-json'),
    error=>error.code==='INVALID_EVALUATION_CONTRACT'
  );
});

test('agents call provider gateway with opaque safety id and evaluator validates JSON',async()=>{
  const calls=[];
  const fetchImpl=async(_url,options)=>{
    const body=JSON.parse(options.body);
    calls.push(body);
    const isEvaluator=(body.messages||[]).some((message)=>String(message?.content||'').includes('Evaluate the completed interview'));
    return {
      ok:true,status:200,headers:{get:()=>null},
      async json(){
        return {
          id:'req-1',model:'local-model',
          choices:[{message:{content:isEvaluator?JSON.stringify(validEvaluation()):'agent output'}}],
          usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}
        };
      }
    };
  };
  const connectionLoader=async()=>({
    providerKind:'openai_compatible',preset:'custom',baseUrl:'https://llm.example/v1',
    defaultModel:'local-model',apiKey:'secret'
  });
  const route={
    connectionId:'conn-1',providerKind:'openai_compatible',preset:'custom',
    model:'local-model',config:{temperature:0.2}
  };

  const patient=await runPatientAgent({
    session,message:'請問您的狀況？',transcript,route,fetchImpl,connectionLoader
  });
  const coach=await runCoachAgent({session,transcript,route,fetchImpl,connectionLoader});
  const evaluator=await runEvaluatorAgent({session,transcript,route,fetchImpl,connectionLoader});

  assert.equal(patient.reply,'agent output');
  assert.equal(coach.guidance,'agent output');
  assert.deepEqual(evaluator.evaluation,validEvaluation());
  assert.match(patient.safetyIdentifier,/^aisp_[0-9a-f]{32}$/);
  assert.equal(patient.safetyIdentifier.includes('student@example.com'),false);
  assert.equal(calls.every(body=>body.user===patient.safetyIdentifier),true);
  assert.equal(calls.at(-1).response_format.type,'json_object');
});

test('agent refuses missing or mock production route instead of silently generating mock output',async()=>{
  await assert.rejects(
    ()=>runPatientAgent({session,message:'hello',transcript,route:null,connectionLoader:async()=>null}),
    error=>error.code==='AI_PROVIDER_NOT_CONFIGURED'
  );
});


test('DeepSeek Patient, Coach, and Evaluator default to stable non-thinking mode unless route config overrides it',async()=>{
  const calls=[];
  const fetchImpl=async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return {
      ok:true,status:200,
      headers:{get:()=>null},
      async json(){return {id:'ds',model:'deepseek-flash',choices:[{message:{content:'ok'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};}
    };
  };
  const connection={providerKind:'openai_compatible',preset:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'x',defaultModel:'deepseek-flash'};
  const route={connection,connectionId:'c1',providerKind:'openai_compatible',preset:'deepseek',model:'deepseek-flash',config:{}};
  const session={student_user_id:'u1',case_snapshot:JSON.stringify({patient:{name:'P'},facts:[],rubric:[]})};

  const evaluation={
    totalScore:0,maxScore:0,percentage:0,items:[],
    overall:{comment:'No evidence.',strengths:[],improvements:[],recommendations:[],nextPracticeFocus:'Ask more questions.'}
  };
  const evaluatorFetch=async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return {
      ok:true,status:200,headers:{get:()=>null},
      async json(){return {id:'ds-eval',model:'deepseek-flash',choices:[{message:{content:JSON.stringify(evaluation)}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};}
    };
  };

  const {runPatientAgent,runCoachAgent,runEvaluatorAgent}=await import('./lib/llm/agents.js');
  await runPatientAgent({session,message:'hi',transcript:[],route,fetchImpl});
  await runCoachAgent({session,transcript:[],route,fetchImpl});
  await runEvaluatorAgent({session,transcript:[],route,fetchImpl:evaluatorFetch});

  assert.deepEqual(calls[0].thinking,{type:'disabled'});
  assert.deepEqual(calls[1].thinking,{type:'disabled'});
  assert.deepEqual(calls[2].thinking,{type:'disabled'});
  assert.equal(calls[2].response_format.type,'json_object');
  assert.equal(calls[2].max_tokens,8192);

  calls.length=0;
  const override={...route,config:{thinkingMode:'enabled'}};
  await runPatientAgent({session,message:'hi',transcript:[],route:override,fetchImpl});
  assert.deepEqual(calls[0].thinking,{type:'enabled'});
});

test('Evaluator prompt includes a concrete JSON example for compatible JSON-output providers',()=>{
  const evaluator=buildEvaluatorPrompt({session,transcript});
  assert.match(evaluator,/Example JSON shape/);
  assert.match(evaluator,/"totalScore":0/);
  assert.match(evaluator,/"status":"missed"/);
});


test('custom prompt templates expand only safe variables and remain subordinate to locked rules',()=>{
  const templatedSession={
    ...session,mode:'training',
    case_snapshot:{...caseDefinition,internalTitle:'Aphasia Practice',learningGoals:['history','communication']}
  };
  const patient=buildPatientPrompt({
    session:templatedSession,
    customTemplate:'Use gentle wording for {{patient_name}} in {{case_title}}. Goals: {{learning_goals}}. Mode={{mode}}.'
  });
  assert.match(patient,/Stay in character/);
  assert.match(patient,/Educator Patient customization/);
  assert.match(patient,/Use gentle wording for 王先生 in Aphasia Practice/);
  assert.ok(patient.indexOf('Stay in character')<patient.indexOf('Educator Patient customization'));

  const evaluator=buildEvaluatorPrompt({
    session:templatedSession,transcript,
    customTemplate:'Be strict about evidence for {{case_title}}.',
    feedbackTemplate:'Give concise, supportive feedback to guide the next practice.'
  });
  assert.match(evaluator,/Educator Evaluator scoring customization/);
  assert.match(evaluator,/Be strict about evidence for Aphasia Practice/);
  assert.match(evaluator,/overall\.comment/);
  assert.match(evaluator,/Give concise, supportive feedback/);
  assert.ok(evaluator.indexOf('Evaluate only evidence')<evaluator.indexOf('Educator Evaluator scoring customization'));

  assert.throws(
    ()=>validatePromptTemplate('Leak {{hidden_facts}}'),
    error=>error.code==='UNSUPPORTED_PROMPT_VARIABLE'
  );
  assert.equal(renderPromptTemplate('{{patient_age}}',{session:templatedSession}),'68');
  const catalog=getPromptTemplateCatalog();
  assert.equal(catalog.maxChars,8000);
  assert.equal(catalog.evaluator.fields.some(field=>field.key==='feedbackTemplate'),true);
  assert.match(catalog.patient.fields[0].example,/1～3 句/);
  assert.match(catalog.coach.fields[0].example,/蘇格拉底式/);
  assert.match(catalog.evaluator.fields.find(field=>field.key==='promptTemplate').example,/partial/);
  assert.match(catalog.evaluator.fields.find(field=>field.key==='feedbackTemplate').example,/nextPracticeFocus/);
  assert.equal(catalog.placeholders.includes('{{hidden_facts}}'),false);
});

test('agents send snapshotted route prompt customizations to provider system prompts',async()=>{
  const bodies=[];
  const fetchImpl=async(_url,options)=>{
    const body=JSON.parse(options.body);
    bodies.push(body);
    const isEvaluator=body.response_format?.type==='json_object';
    return {
      ok:true,status:200,headers:{get:()=>null},
      async json(){return {
        id:'custom-prompt-test',model:'local-model',
        choices:[{message:{content:isEvaluator?JSON.stringify(validEvaluation()):'ok'}}],
        usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}
      };}
    };
  };
  const connection={providerKind:'openai_compatible',preset:'custom',baseUrl:'https://llm.example/v1',apiKey:'x',defaultModel:'local-model'};
  await runPatientAgent({
    session,message:'hi',transcript:[],fetchImpl,
    route:{connection,providerKind:'openai_compatible',preset:'custom',model:'local-model',config:{promptTemplate:'Patient custom {{patient_name}}'}}
  });
  await runCoachAgent({
    session,transcript,fetchImpl,
    route:{connection,providerKind:'openai_compatible',preset:'custom',model:'local-model',config:{promptTemplate:'Coach custom instruction'}}
  });
  await runEvaluatorAgent({
    session,transcript,fetchImpl,
    route:{connection,providerKind:'openai_compatible',preset:'custom',model:'local-model',config:{promptTemplate:'Score custom',feedbackTemplate:'Feedback custom'}}
  });

  assert.match(bodies[0].messages[0].content,/Patient custom 王先生/);
  assert.match(bodies[1].messages[0].content,/Coach custom instruction/);
  assert.match(bodies[2].messages[0].content,/Score custom/);
  assert.match(bodies[2].messages[0].content,/Feedback custom/);
});


test('evaluation parser accepts fenced or wrapped JSON without a second LLM call',()=>{
  const valid=JSON.stringify(validEvaluation(),null,2);
  assert.deepEqual(parseAndValidateEvaluation('Here is the result:\n\`\`\`json\n'+valid+'\n\`\`\`'),validEvaluation());
  assert.deepEqual(parseAndValidateEvaluation('prefix text '+valid+' trailing text'),validEvaluation());
});

test('evaluator repair agent converts malformed contract output into validated JSON',async()=>{
  const calls=[];
  const fetchImpl=async(_url,options)=>{
    const body=JSON.parse(options.body);
    calls.push(body);
    return {
      ok:true,status:200,headers:{get:()=>null},
      async json(){return {
        id:'repair-1',model:'deepseek-flash',
        choices:[{message:{content:JSON.stringify(validEvaluation())}}],
        usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}
      };}
    };
  };
  const route={
    connection:{
      providerKind:'openai_compatible',preset:'deepseek',
      baseUrl:'https://api.deepseek.com',apiKey:'x',defaultModel:'deepseek-flash'
    },
    providerKind:'openai_compatible',preset:'deepseek',model:'deepseek-flash',config:{}
  };
  const result=await repairEvaluatorAgent({
    session,transcript,route,fetchImpl,
    invalidOutput:'{"totalScore":10,"items":[]}',
    validationError:Object.assign(new Error('overall'),{code:'INVALID_EVALUATION_CONTRACT'})
  });
  assert.deepEqual(result.evaluation,validEvaluation());
  assert.equal(result.repaired,true);
  const repairUserMessage=calls[0].messages.find(message=>message.role==='user')?.content||'';
  assert.match(repairUserMessage,/Previous evaluator output/);
  assert.match(repairUserMessage,/"totalScore":10/);
  assert.deepEqual(calls[0].thinking,{type:'disabled'});
  assert.equal(calls[0].response_format.type,'json_object');
  assert.equal(calls[0].max_tokens,8192);
  const repairPrompt=buildEvaluatorRepairPrompt({session,transcript});
  assert.match(repairPrompt,/JSON repair step/);
  assert.match(repairPrompt,/Do not invent transcript evidence/);
});

test('evaluator repair agent reports repair-specific failure after a second invalid contract',async()=>{
  const fetchImpl=async()=>({
    ok:true,status:200,headers:{get:()=>null},
    async json(){return {
      id:'repair-bad',model:'deepseek-flash',
      choices:[{message:{content:'{"totalScore":10}'}}],
      usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}
    };}
  });
  const route={
    connection:{
      providerKind:'openai_compatible',preset:'deepseek',
      baseUrl:'https://api.deepseek.com',apiKey:'x',defaultModel:'deepseek-flash'
    },
    providerKind:'openai_compatible',preset:'deepseek',model:'deepseek-flash',config:{}
  };
  await assert.rejects(
    ()=>repairEvaluatorAgent({session,transcript,route,fetchImpl,invalidOutput:'bad'}),
    error=>error.code==='EVALUATION_REPAIR_FAILED'&&Boolean(error.llmResult)
  );
});
