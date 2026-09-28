import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvaluatorPrompt,buildEvaluatorTask,buildEvaluatorRepairTask
} from './lib/llm/prompts.js';
import {
  runEvaluatorAgent,repairEvaluatorAgent
} from './lib/llm/agents.js';

const session={
  student_user_id:'student@example.com',
  case_snapshot:{
    id:'case-1',
    patient:{name:'王先生',age:68,gender:'男'},
    facts:[],
    rubric:[{id:'history',label:'詢問重要病史',points:10}]
  }
};
const transcript=[
  {role:'patient',content:'你好。'},
  {role:'student',content:'以前有住院過嗎？'}
];
const route={
  connection:{
    providerKind:'openai_compatible',
    preset:'groq',
    baseUrl:'https://api.groq.com/openai/v1',
    apiKey:'test-key',
    defaultModel:'openai/gpt-oss-120b'
  },
  providerKind:'openai_compatible',
  preset:'groq',
  model:'openai/gpt-oss-120b',
  config:{}
};
function zhTwEvaluation(){
  return {
    totalScore:10,maxScore:10,percentage:100,
    items:[{
      id:'history',criterion:'詢問重要病史',status:'covered',score:10,maxScore:10,
      evidence:[{turn:2,quote:'以前有住院過嗎？'}],
      reasoning:'學生有直接詢問重要病史，符合此評量項目。'
    }],
    overall:{
      comment:'本次問診已涵蓋主要評量面向。',
      strengths:['能主動詢問重要病史'],
      improvements:[],
      recommendations:['可繼續增加追問深度'],
      nextPracticeFocus:'重要病史的追問深度'
    }
  };
}
function responseFor(value,id='eval'){
  return {
    ok:true,status:200,headers:{get:()=>null},
    async json(){return {
      id,model:'openai/gpt-oss-120b',
      choices:[{message:{content:JSON.stringify(value)}}],
      usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}
    };}
  };
}

test('Evaluator prompts explicitly require Traditional Chinese output',()=>{
  const evaluator=buildEvaluatorPrompt({session});
  const task=buildEvaluatorTask({transcript});
  const repair=buildEvaluatorRepairTask({
    transcript,
    invalidOutput:'previous invalid evaluator output',
    validationError:new Error('evaluation.language.zh-TW:overall.comment')
  });

  assert.match(evaluator,/Traditional Chinese \(zh-TW\)/);
  assert.match(evaluator,/Do not answer those fields in English or Simplified Chinese/);
  assert.match(evaluator,/"reasoning":"學生有直接詢問重要病史/);
  assert.match(evaluator,/"comment":"本次問診已涵蓋主要評量面向/);
  assert.match(task,/Traditional Chinese \(zh-TW\)/);
  assert.match(repair,/Rewrite every human-readable evaluation field into Traditional Chinese \(zh-TW\)/);
  assert.match(repair,/evidence\.quote verbatim/);
});

test('Evaluator rejects English prose so automatic repair can run',async()=>{
  const english=zhTwEvaluation();
  english.items[0].reasoning='The transcript directly supports this criterion.';
  english.overall={
    comment:'The interview was incomplete.',
    strengths:['Identified the chief complaint'],
    improvements:['Ask about medical history'],
    recommendations:['Use a complete interview framework'],
    nextPracticeFocus:'Comprehensive history taking'
  };

  await assert.rejects(
    ()=>runEvaluatorAgent({
      session,transcript,route,
      fetchImpl:async()=>responseFor(english,'english-eval')
    }),
    error=>error.code==='INVALID_EVALUATION_CONTRACT' &&
      String(error.message).startsWith('evaluation.language.zh-TW:')
  );
});

test('Evaluator repair accepts zh-TW prose and preserves evidence quote',async()=>{
  const repaired=zhTwEvaluation();
  const result=await repairEvaluatorAgent({
    session,transcript,route,
    invalidOutput:'previous English output',
    validationError:Object.assign(new Error('evaluation.language.zh-TW:overall.comment'),{
      code:'INVALID_EVALUATION_CONTRACT'
    }),
    fetchImpl:async()=>responseFor(repaired,'zh-tw-repair')
  });

  assert.deepEqual(result.evaluation,repaired);
  assert.equal(result.repaired,true);
  assert.equal(result.evaluation.items[0].evidence[0].quote,'以前有住院過嗎？');
});
