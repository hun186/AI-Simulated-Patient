import { getCase } from './cases.js';

const normalise = (text = '') => text.toLowerCase().replace(/[，。！？、,.!?\s]/g, '');

function matchFacts(caseData, userText) {
  const text = normalise(userText);
  return caseData.facts.filter((fact) => fact.triggers.some((t) => text.includes(normalise(t))));
}

function naturalise(caseData, facts, userText) {
  if (!facts.length) {
    if (/你好|您好|嗨|早安|午安/.test(userText)) {
      return `你好，我是${caseData.patient.name}。`;
    }
    if (/還有|其他|補充|全部|都告訴/.test(userText)) {
      return '嗯……你可以再問得具體一點，我再跟你說。';
    }
    return '這個我不太確定你是問哪一方面，可以再問我詳細一點嗎？';
  }

  if (facts.length === 1) return `嗯……${facts[0].value}`;

  // Limit disclosure even when one broad question happens to match many triggers.
  const selected = facts.slice(0, 2);
  return selected.map((f, i) => `${i === 0 ? '嗯……' : '另外，'}${f.value}`).join('');
}

export function mockPatientReply({ caseId, message, revealedFactIds = [] }) {
  const caseData = getCase(caseId);
  if (!caseData) throw new Error('CASE_NOT_FOUND');
  const matched = matchFacts(caseData, message);
  const newlyRevealed = matched.map((f) => f.id).filter((id) => !revealedFactIds.includes(id));
  return {
    reply: naturalise(caseData, matched, message),
    revealedFactIds: [...new Set([...revealedFactIds, ...newlyRevealed])],
    newlyRevealedFactIds: newlyRevealed,
    provider: 'mock'
  };
}
