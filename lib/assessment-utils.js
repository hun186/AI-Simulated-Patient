const normalise = (text = '') => String(text).toLowerCase().replace(/[，。！？、,.!?\s]/g, '');

const categorySignals = {
  current_problem:['困擾','問題','症狀','不舒服','怎麼了'],
  onset_course:['開始','多久','時間','變化','惡化','進展'],
  medical_history:['以前','疾病','病史','住院','手術','神經','腦'],
  language_comprehension:['理解','聽懂','指令','別人說話'],
  expressive_language:['表達','說話','講話','找詞','名稱'],
  reading_writing:['閱讀','看字','文章','寫字','書寫','打字'],
  swallowing_screen:['吞','吃','喝','嗆','咳嗽'],
  participation:['生活','工作','社交','家人','朋友','電話','活動'],
  support:['家人','支持','照顧','陪伴'],
  goal:['目標','希望','期待','改善','想要']
};

export function studentTurns(transcript = []) {
  return transcript.map((m, index) => ({...m, index})).filter((m) => m.role === 'student');
}

export function questionQuality(question = '') {
  const raw = String(question).trim();
  const flags = [];
  if (!raw) return { level:'needs_improvement', flags:['empty'], comment:'沒有可評估的問句。' };
  if (/是不是|對不對|應該.*吧|沒有.*吧|一定/.test(raw)) flags.push('leading');
  if (raw.length <= 5) flags.push('too_brief');
  if ((raw.match(/[？?]/g) || []).length > 1 || /還有.*還有|以及.*還有/.test(raw)) flags.push('multi_question');
  if (/為什麼你不|怎麼不/.test(raw)) flags.push('judgmental');

  let level = 'good';
  let comment = '問句清楚，能讓病人針對一個主題回答。';
  if (flags.includes('leading')) { level='needs_improvement'; comment='這個問法帶有誘導性；可改成較中性的開放式或確認式問題。'; }
  else if (flags.includes('too_brief')) { level='needs_improvement'; comment='問句較短且語意偏模糊；可補上時間、功能或情境，使病人更容易回答。'; }
  else if (flags.includes('multi_question')) { level='needs_improvement'; comment='一次包含多個問題；建議拆成單一焦點逐步追問。'; }
  else if (flags.includes('judgmental')) { level='needs_improvement'; comment='問句可能讓病人感到被評價；可改用中性描述。'; }
  return { level, flags, comment };
}

function findEvidenceForFact(fact, turns) {
  const triggers = (fact.triggers || []).map(normalise).filter(Boolean);
  for (const turn of turns) {
    const text = normalise(turn.content);
    if (triggers.some((trigger) => text.includes(trigger))) return turn;
  }
  return null;
}

function findPartialEvidence(fact, turns) {
  const signals = categorySignals[fact.category] || [];
  for (const turn of turns) {
    const text = normalise(turn.content);
    if (signals.some((signal) => text.includes(normalise(signal)))) return turn;
  }
  return null;
}

export function assessCriterion({ criterion, caseData, transcript, revealedFactIds = [] }) {
  const turns = studentTurns(transcript);
  const facts = (criterion.factIds || []).map((id) => caseData.facts.find((fact) => fact.id === id)).filter(Boolean);
  const directEvidence = facts.map((fact) => findEvidenceForFact(fact, turns)).find(Boolean) || null;
  const partialEvidence = directEvidence || facts.map((fact) => findPartialEvidence(fact, turns)).find(Boolean) || null;
  const wasRevealed = facts.some((fact) => revealedFactIds.includes(fact.id));

  let status='missed';
  if (wasRevealed || directEvidence) status='covered';
  else if (partialEvidence) status='partial';

  const maxScore = Number(criterion.points) || 0;
  const q = questionQuality((directEvidence || partialEvidence)?.content || '');
  let ratio = status === 'covered' ? 1 : status === 'partial' ? 0.5 : 0;
  if (status === 'covered' && q.flags.includes('leading')) ratio = 0.8;
  const score = Math.round(maxScore * ratio);
  const evidenceTurn = directEvidence || partialEvidence;

  return {
    id:criterion.id, criterion:criterion.label, status, score, maxScore,
    evidence:evidenceTurn ? [{turn:evidenceTurn.index + 1, quote:evidenceTurn.content}] : [],
    reasoning:status === 'covered'
      ? '完整問到此評量主題，且病例資訊已被合理觸發。'
      : status === 'partial'
        ? '有碰到相關方向，但問法仍不足以完整取得此項必要資訊。'
        : '完整問診紀錄中未找到足以涵蓋此項目的問題。',
    questionQuality:q
  };
}
