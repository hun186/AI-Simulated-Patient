import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCase,getPublicCases,isUsableCaseDefinition
} from './lib/cases.js';
import { buildPatientPrompt } from './lib/llm/prompts.js';
import { mockPatientReply } from './lib/mock-patient.js';
import demoHandler from './api/demo.js';

const voiceCase=getCase('voice_nodule_001');

test('voice nodule case is a valid built-in public demo case',()=>{
  assert.ok(voiceCase);
  assert.equal(voiceCase.patient.name,'林麗娟');
  assert.equal(isUsableCaseDefinition(voiceCase),true);
  assert.deepEqual(
    getPublicCases().map((item)=>item.id),
    ['aphasia_001','voice_nodule_001']
  );
  assert.match(voiceCase.studentBrief,/嗓音評估與衛教/);
});

test('patient LLM prompt preserves case-specific disclosure, text-only, and counseling behavior',()=>{
  const patientPrompt=buildPatientPrompt({
    session:{case_snapshot:voiceCase,student_user_id:'student-1'}
  });
  assert.match(patientPrompt,/林麗娟/);
  assert.match(patientPrompt,/學生沒有問到的資訊不要一次全部說出來/);
  assert.match(patientPrompt,/病例未提供的細節不可自行編造/);
  assert.match(patientPrompt,/純文字模擬/);
  assert.match(patientPrompt,/可以用咖啡或茶代替嗎/);
  assert.match(patientPrompt,/聲帶長繭以後是不是就不會恢復了/);
  assert.doesNotMatch(patientPrompt,/points":10/);
});

test('mock patient reveals history on questions and uses counseling response rules',()=>{
  const history=mockPatientReply({
    caseId:'voice_nodule_001',
    message:'你平常喝水、咖啡跟其他飲料的習慣怎麼樣？',
    revealedFactIds:[]
  });
  assert.match(history.reply,/熱美式/);
  assert.ok(history.revealedFactIds.includes('hydration_caffeine'));

  const counseling=mockPatientReply({
    caseId:'voice_nodule_001',
    message:'平常要多喝水，也可以增加喝水的次數。',
    revealedFactIds:history.revealedFactIds
  });
  assert.equal(counseling.interactionRuleId,'hydration_advice');
  assert.match(counseling.reply,/一次要喝很多水嗎/);
  assert.match(counseling.reply,/咖啡或茶代替嗎/);
  assert.deepEqual(counseling.revealedFactIds,history.revealedFactIds);
});

test('demo cases route exposes both built-in teaching cases',async()=>{
  const req={method:'GET',query:{route:'cases'},url:'/api/demo?route=cases'};
  const res={
    statusCode:200,body:null,
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return body;}
  };
  await demoHandler(req,res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body.cases.map((item)=>item.id),['aphasia_001','voice_nodule_001']);
});
