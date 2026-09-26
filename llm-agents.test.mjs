import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatientPrompt,buildCoachPrompt,buildEvaluatorPrompt,evaluationResponseFormat
} from './lib/llm/prompts.js';
import {
  validateEvaluationContract,parseAndValidateEvaluation
} from './lib/llm/evaluation-contract.js';
import {
  runPatientAgent,runCoachAgent,runEvaluatorAgent
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


test('DeepSeek Patient and Coach default to non-thinking mode unless route config overrides it',async()=>{
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

  const {runPatientAgent,runCoachAgent}=await import('./lib/llm/agents.js');
  await runPatientAgent({session,message:'hi',transcript:[],route,fetchImpl});
  await runCoachAgent({session,transcript:[],route,fetchImpl});

  assert.deepEqual(calls[0].thinking,{type:'disabled'});
  assert.deepEqual(calls[1].thinking,{type:'disabled'});

  calls.length=0;
  const override={...route,config:{thinkingMode:'enabled'}};
  await runPatientAgent({session,message:'hi',transcript:[],route:override,fetchImpl});
  assert.deepEqual(calls[0].thinking,{type:'enabled'});
});
