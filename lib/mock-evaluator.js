import { getCase } from './cases.js';

export function mockEvaluate({ caseId, transcript = [], revealedFactIds = [] }) {
  const caseData = getCase(caseId);
  if (!caseData) throw new Error('CASE_NOT_FOUND');

  const studentTurns = transcript.filter((m) => m.role === 'student');
  const studentText = studentTurns.map((m) => m.content).join(' ');

  const items = caseData.rubric.map((criterion) => {
    const coveredFacts = criterion.factIds.filter((id) => revealedFactIds.includes(id));
    const earned = coveredFacts.length ? criterion.points : 0;
    return {
      id: criterion.id,
      criterion: criterion.label,
      score: earned,
      maxScore: criterion.points,
      status: earned ? 'covered' : 'missed',
      evidence: earned ? '問診內容觸發並取得此項病例資訊。' : '對話中未取得對應病例資訊。'
    };
  });

  const totalScore = items.reduce((sum, item) => sum + item.score, 0);
  const maxScore = items.reduce((sum, item) => sum + item.maxScore, 0);
  const missed = items.filter((item) => item.status === 'missed').map((item) => item.criterion);
  const covered = items.filter((item) => item.status === 'covered').map((item) => item.criterion);

  const feedback = [];
  if (covered.length) feedback.push(`已涵蓋：${covered.slice(0, 4).join('、')}${covered.length > 4 ? '等' : ''}。`);
  if (missed.length) feedback.push(`可再補問：${missed.slice(0, 4).join('、')}${missed.length > 4 ? '等' : ''}。`);
  if (studentTurns.length < 4) feedback.push('問診輪次較少，可嘗試由主訴、病史、功能影響到病人目標逐步展開。');

  return {
    provider: 'mock',
    totalScore,
    maxScore,
    percentage: Math.round((totalScore / maxScore) * 100),
    items,
    feedback,
    note: 'POC 的 Mock 評分只依「是否觸發病例資訊」計分；正式版應改用結構化 rubric + LLM judge + 可稽核 evidence。',
    debug: { studentTextLength: studentText.length, studentTurns: studentTurns.length }
  };
}
