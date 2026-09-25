import { resolveCase } from './cases.js';
import { assessCriterion, questionQuality, studentTurns } from './assessment-utils.js';

function buildOverall(items, transcript, percentage, mode) {
  const covered=items.filter((x)=>x.status==='covered');
  const partial=items.filter((x)=>x.status==='partial');
  const missed=items.filter((x)=>x.status==='missed');
  const turns=studentTurns(transcript);
  const qualityIssues=turns.map((turn)=>({turn,q:questionQuality(turn.content)})).filter((x)=>x.q.level!=='good');

  const strengths=[];
  if (covered.length) strengths.push(`已完整涵蓋 ${covered.length} 個核心問診項目，包括：${covered.slice(0,3).map((x)=>x.criterion).join('、')}。`);
  if (turns.length>=6) strengths.push('問診有一定深度，能持續追問而非只停留在單一問題。');
  if (!qualityIssues.some((x)=>x.q.flags.includes('leading'))) strengths.push('多數問句維持中性，較不容易誘導病人作答。');
  if (!strengths.length) strengths.push('已完成基本問診流程，具有可進一步精進的對話基礎。');

  const improvements=[];
  if (missed.length) improvements.push(`仍漏掉 ${missed.length} 個核心項目，優先補強：${missed.slice(0,3).map((x)=>x.criterion).join('、')}。`);
  if (partial.length) improvements.push(`有 ${partial.length} 個項目只問到部分方向，可增加具體追問以取得完整資訊。`);
  if (qualityIssues.some((x)=>x.q.flags.includes('leading'))) improvements.push('部分問句帶有誘導性，建議改用中性開放式問句後，再用封閉式問題確認細節。');
  if (turns.length<4) improvements.push('問診輪次偏少，建議依「主訴 → 時間病程 → 功能面向 → 病史 → 生活影響 → 目標」建立固定框架。');

  const recommendations=[];
  if (missed[0]) recommendations.push(`下一次練習時，先刻意加入「${missed[0].criterion}」的探索。`);
  if (partial[0]) recommendations.push(`針對「${partial[0].criterion}」，練習至少一個開放式問題加一個追問。`);
  recommendations.push(mode==='training' ? '可在訓練模式中使用 AI 教練提示，逐輪修正問句品質。' : '建議先在訓練模式重做同一病例，再回到考試模式比較前後差異。');

  let comment;
  if (percentage>=85) comment='整體問診架構完整，主要評量面向大多有被涵蓋。下一步重點不是增加問題數，而是讓問題更精準、自然，並依病人回答做更有層次的追問。';
  else if (percentage>=65) comment='已建立基本問診架構，但部分重要面向仍有遺漏或追問不足。若能把目前零散的問題整理成固定框架，整體完整性與臨床效率會明顯提升。';
  else comment='目前問診仍偏向局部資訊蒐集，尚未形成完整的臨床問診架構。建議先以固定順序完成核心面向，再練習依病人回答彈性追問。';

  return {comment,strengths,improvements,recommendations,nextPracticeFocus:(missed[0]||partial[0])?.criterion||'問句品質與追問深度'};
}

export function mockEvaluate({ caseId, caseDefinition=null, transcript=[], revealedFactIds=[], mode='exam' }) {
  const caseData=resolveCase(caseId,caseDefinition);
  if (!caseData) throw new Error('CASE_NOT_FOUND');
  const items=caseData.rubric.map((criterion)=>assessCriterion({criterion,caseData,transcript,revealedFactIds}));
  const totalScore=items.reduce((sum,item)=>sum+item.score,0);
  const maxScore=items.reduce((sum,item)=>sum+item.maxScore,0);
  const percentage=maxScore?Math.round((totalScore/maxScore)*100):0;
  const overall=buildOverall(items,transcript,percentage,mode);
  return {
    provider:'mock-semantic-judge',judgeVersion:'poc-v2',mode,totalScore,maxScore,percentage,items,overall,
    feedback:[...overall.strengths,...overall.improvements],
    note:'此 POC 使用 deterministic semantic-like judge 模擬正式 LLM 評量輸出；正式部署時可將此 provider 替換為結構化 LLM judge，資料契約不需改變。'
  };
}
