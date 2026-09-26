import { resolveCase } from './cases.js';

const normalise = (text = '') => text.toLowerCase().replace(/[，。！？、,.!?\s]/g, '');

function matchFacts(caseData, userText) {
  const text = normalise(userText);
  return caseData.facts.filter((fact) =>
    (fact.triggers || []).some((trigger) => text.includes(normalise(trigger)))
  );
}

function matchResponseRule(caseData, userText) {
  const text = normalise(userText);
  return (caseData.responseRules || []).find((rule) =>
    (rule.triggers || []).some((trigger) => text.includes(normalise(trigger)))
  ) || null;
}

function naturalise(caseData, facts, userText) {
  if (!facts.length) {
    if (/你好|您好|嗨|早安|午安/.test(userText)) return `你好，我是${caseData.patient.name}。`;
    if (/還有|其他|補充|全部|都告訴/.test(userText)) return '嗯……你可以再問得具體一點，我再跟你說。';
    return '這個我不太確定你是問哪一方面，可以再問我詳細一點嗎？';
  }
  if (facts.length === 1) return `嗯……${facts[0].value}`;
  return facts.slice(0, 2).map((fact, i) => `${i === 0 ? '嗯……' : '另外，'}${fact.value}`).join('');
}

export function mockPatientReply({ caseId, caseDefinition = null, message, revealedFactIds = [] }) {
  const caseData = resolveCase(caseId, caseDefinition);
  if (!caseData) throw new Error('CASE_NOT_FOUND');

  const responseRule = matchResponseRule(caseData, message);
  if (responseRule) {
    return {
      reply: responseRule.response,
      revealedFactIds: [...new Set(revealedFactIds)],
      newlyRevealedFactIds: [],
      interactionRuleId: responseRule.id,
      provider: 'mock'
    };
  }

  const matched = matchFacts(caseData, message);
  const newlyRevealed = matched.map((fact) => fact.id).filter((id) => !revealedFactIds.includes(id));
  return {
    reply: naturalise(caseData, matched, message),
    revealedFactIds: [...new Set([...revealedFactIds, ...newlyRevealed])],
    newlyRevealedFactIds: newlyRevealed,
    provider: 'mock'
  };
}
