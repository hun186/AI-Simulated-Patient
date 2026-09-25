import test from 'node:test';
import assert from 'node:assert/strict';
import { mockPatientReply } from './lib/mock-patient.js';
import { mockEvaluate } from './lib/mock-evaluator.js';
import { mockCoach } from './lib/mock-coach.js';
import { getPublicCase } from './lib/cases.js';

test('patient does not dump unrelated facts for greeting',()=>{
  const out=mockPatientReply({caseId:'aphasia_001',message:'你好',revealedFactIds:[]});
  assert.equal(out.revealedFactIds.length,0);
});

test('stroke history can be revealed by relevant question',()=>{
  const out=mockPatientReply({caseId:'aphasia_001',message:'以前有中風或重大病史嗎？',revealedFactIds:[]});
  assert.ok(out.revealedFactIds.includes('stroke_history'));
});

test('evaluator returns covered partial missed contract and overall comment',()=>{
  const transcript=[{role:'student',content:'主要是哪裡不舒服？'},{role:'patient',content:'講話不太順。'},{role:'student',content:'以前有腦部方面的疾病嗎？'}];
  const out=mockEvaluate({caseId:'aphasia_001',transcript,revealedFactIds:['chief_complaint'],mode:'exam'});
  assert.equal(out.provider,'mock-semantic-judge');
  assert.ok(['covered','partial','missed'].includes(out.items[0].status));
  assert.ok(out.overall.comment.length>10);
  assert.ok(Array.isArray(out.overall.recommendations));
});

test('training coach returns non-answer next-step hint',()=>{
  const out=mockCoach({caseId:'aphasia_001',transcript:[{role:'student',content:'怎麼了？'}],revealedFactIds:['chief_complaint']});
  assert.equal(out.provider,'mock-learning-coach');
  assert.ok(out.nextHint.includes('方向'));
  assert.ok(out.progress.total>0);
});

test('leading question can receive quality penalty',()=>{
  const transcript=[{role:'student',content:'你是不是有中風？'}];
  const out=mockEvaluate({caseId:'aphasia_001',transcript,revealedFactIds:['stroke_history'],mode:'training'});
  const item=out.items.find((x)=>x.id==='history');
  assert.equal(item.status,'covered');
  assert.ok(item.score<item.maxScore);
  assert.ok(item.questionQuality.flags.includes('leading'));
});

test('teacher-created case supports coaching and evaluation',()=>{
  const custom={id:'custom_swallow',title:'吞嚥困難',publicBrief:'吞嚥問診',learningGoals:['辨識嗆咳'],patient:{name:'林女士',age:72,gender:'女',persona:''},opening:'最近吃東西有點不順。',facts:[{id:'liquid',label:'喝水嗆咳',category:'swallowing_screen',value:'喝水時常會嗆到。',triggers:['喝水','嗆'],mayVolunteer:false}],rubric:[{id:'liquid_check',label:'詢問液體吞嚥',factIds:['liquid'],points:20}]};
  const chat=mockPatientReply({caseId:'custom_swallow',caseDefinition:custom,message:'喝水會嗆到嗎？'});
  const score=mockEvaluate({caseId:'custom_swallow',caseDefinition:custom,transcript:[{role:'student',content:'喝水會嗆到嗎？'}],revealedFactIds:chat.revealedFactIds,mode:'training'});
  const coach=mockCoach({caseId:'custom_swallow',caseDefinition:custom,transcript:[{role:'student',content:'喝水會嗆到嗎？'}],revealedFactIds:chat.revealedFactIds});
  assert.equal(score.percentage,100);
  assert.equal(coach.progress.covered,1);
});


test('student-facing case payload does not leak diagnosis or etiology',()=>{
  const view=getPublicCase('aphasia_001');
  assert.equal('title' in view,false);
  assert.equal('learningGoals' in view,false);
  assert.ok(view.studentLabel);
  assert.doesNotMatch(view.studentLabel,/中風|失語|腦血管/);
  assert.doesNotMatch(view.studentBrief,/中風|失語|腦血管/);
});

test('training coach hint avoids revealing hidden stroke answer',()=>{
  const transcript=[
    {role:'student',content:'主要是哪裡不舒服？'},
    {role:'patient',content:'最近講話不太順。'},
    {role:'student',content:'這個狀況大概多久了？'}
  ];
  const out=mockCoach({caseId:'aphasia_001',transcript,revealedFactIds:['chief_complaint','onset']});
  assert.doesNotMatch(out.nextHint,/中風|失語|腦血管|左側/);
  assert.equal('learningGoals' in out,false);
});
