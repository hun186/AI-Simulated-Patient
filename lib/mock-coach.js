import { resolveCase } from './cases.js';
import { assessCriterion, questionQuality, studentTurns } from './assessment-utils.js';

export function mockCoach({ caseId, caseDefinition=null, transcript=[], revealedFactIds=[] }) {
  const caseData=resolveCase(caseId,caseDefinition);
  if (!caseData) throw new Error('CASE_NOT_FOUND');
  const turns=studentTurns(transcript);
  const items=caseData.rubric.map((criterion)=>assessCriterion({criterion,caseData,transcript,revealedFactIds}));
  const covered=items.filter((item)=>item.status==='covered').length;
  const partial=items.filter((item)=>item.status==='partial').length;
  const next=items.find((item)=>item.status==='missed') || items.find((item)=>item.status==='partial');
  const last=turns.at(-1);
  const lastQuality=questionQuality(last?.content||'');
  let nextHint='先根據病人的上一個回答追問細節，再決定下一個主題。';
  if (next) {
    const criterion=caseData.rubric.find((item)=>item.id===next.id);
    nextHint=criterion?.coachHint || '還有尚未完整探索的面向。回顧主訴、時間、功能、過去病史、生活影響與目標，選一個尚未問清楚的方向。';
  }
  return {
    provider:'mock-learning-coach',coachVersion:'poc-v1',
    progress:{covered,partial,total:items.length},
    lastQuestion:last?{text:last.content,...lastQuality}:null,
    nextHint,
    reflectionPrompt:'在送出下一題前，想一下：這題要釐清的是「症狀、時間、功能、病史、生活影響」中的哪一類？'
  };
}
