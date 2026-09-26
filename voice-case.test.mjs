import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCase,getPublicCases,isUsableCaseDefinition
} from './lib/cases.js';
import { buildPatientPrompt } from './lib/llm/prompts.js';
import { mockPatientReply } from './lib/mock-patient.js';
import { mockEvaluate } from './lib/mock-evaluator.js';
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
  assert.match(voiceCase.facts.find((fact)=>fact.id==='residence').value,/台北市中山區/);
  assert.match(voiceCase.facts.find((fact)=>fact.id==='family_status').value,/未婚/);
  assert.match(voiceCase.facts.find((fact)=>fact.id==='teaching_tenure').value,/2年/);
  assert.match(voiceCase.facts.find((fact)=>fact.id==='diagnosis').value,/12月/);
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

test('mock evaluator scores counseling from student actions rather than history questions',()=>{
  const historyOnly=[
    {role:'patient',content:voiceCase.opening},
    {role:'student',content:'你平常喝水跟咖啡的習慣怎麼樣？'},
    {role:'patient',content:'我每天都會喝咖啡。'},
    {role:'student',content:'你上課會不會常常需要大聲說話？'},
    {role:'patient',content:'有時候下課環境很吵。'}
  ];
  const historyScore=mockEvaluate({
    caseId:'voice_nodule_001',transcript:historyOnly,revealedFactIds:['hydration_caffeine','microphone_noise']
  });
  const historyEducation=historyScore.items.find((item)=>item.id==='voice_education');
  const historyExplanation=historyScore.items.find((item)=>item.id==='voice_explanation');
  assert.equal(historyEducation.status,'missed');
  assert.equal(historyExplanation.status,'missed');

  const counseled=[
    ...historyOnly,
    {role:'student',content:'建議你多喝水，也要減少大聲說話，讓聲音有休息的時間。'},
    {role:'patient',content:'好，我會試試看。'},
    {role:'student',content:'聲帶結節通常是聲帶反覆碰撞、加上過度用聲慢慢形成的。'}
  ];
  const counseledScore=mockEvaluate({
    caseId:'voice_nodule_001',transcript:counseled,revealedFactIds:['hydration_caffeine','microphone_noise']
  });
  assert.equal(counseledScore.items.find((item)=>item.id==='voice_education').status,'covered');
  assert.equal(counseledScore.items.find((item)=>item.id==='voice_explanation').status,'covered');
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
