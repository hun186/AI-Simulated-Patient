const STORAGE_KEY = 'ai-simulated-patient-poc-session-v1';
const state = {
  caseId: 'aphasia_001',
  transcript: [],
  revealedFactIds: [],
  caseData: null
};

const $ = (id) => document.getElementById(id);

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    caseId: state.caseId,
    transcript: state.transcript,
    revealedFactIds: state.revealedFactIds
  }));
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.caseId === state.caseId) {
      state.transcript = Array.isArray(saved.transcript) ? saved.transcript : [];
      state.revealedFactIds = Array.isArray(saved.revealedFactIds) ? saved.revealedFactIds : [];
    }
  } catch {}
}

function addMessage(role, content) {
  state.transcript.push({ role, content, at: new Date().toISOString() });
  save();
  renderChat();
}

function renderChat() {
  const chat = $('chat');
  chat.innerHTML = '';
  for (const msg of state.transcript) {
    const wrap = document.createElement('div');
    wrap.className = `message ${msg.role === 'student' ? 'student' : 'patient'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = msg.role === 'student' ? '學生' : '模擬病人';
    const text = document.createElement('div');
    text.textContent = msg.content;
    bubble.append(role, text);
    wrap.append(bubble);
    chat.append(wrap);
  }
  chat.scrollTop = chat.scrollHeight;
  $('turnCount').textContent = state.transcript.filter((m) => m.role === 'student').length;
  $('factCount').textContent = state.revealedFactIds.length;
}

async function sendMessage(message) {
  addMessage('student', message);
  $('sendBtn').disabled = true;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: state.caseId, message, revealedFactIds: state.revealedFactIds })
    });
    if (!res.ok) throw new Error('chat failed');
    const data = await res.json();
    state.revealedFactIds = data.revealedFactIds;
    addMessage('patient', data.reply);
  } catch {
    addMessage('patient', '（系統暫時無法取得回覆，請稍後再試。）');
  } finally {
    $('sendBtn').disabled = false;
    $('messageInput').focus();
  }
}

async function evaluate() {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: state.caseId, transcript: state.transcript, revealedFactIds: state.revealedFactIds })
  });
  if (!res.ok) return alert('評分失敗');
  const data = await res.json();
  $('resultCard').classList.remove('hidden');
  $('scoreCircle').textContent = `${data.percentage}`;
  $('feedback').innerHTML = `<ul class="feedback-list">${data.feedback.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p class="hint">${escapeHtml(data.note)}</p>`;
  $('rubricTable').innerHTML = data.items.map((item) => `
    <div class="rubric-row">
      <strong>${escapeHtml(item.criterion)}</strong>
      <span>${item.score} / ${item.maxScore}</span>
      <span class="${item.status === 'covered' ? 'ok' : 'miss'}">${item.status === 'covered' ? '已涵蓋' : '未涵蓋'}</span>
    </div>`).join('');
  $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function reset() {
  state.transcript = [{ role: 'patient', content: state.caseData.opening, at: new Date().toISOString() }];
  state.revealedFactIds = [];
  $('resultCard').classList.add('hidden');
  save();
  renderChat();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function init() {
  const res = await fetch('/api/cases');
  const data = await res.json();
  state.caseData = data.cases[0];
  $('caseTitle').textContent = state.caseData.title;
  $('caseBrief').textContent = state.caseData.publicBrief;
  load();
  if (!state.transcript.length) reset(); else renderChat();

  // Teacher demo data is intentionally local to the POC presentation.
  const casePreview = {
    case_id: 'aphasia_001',
    fact: '兩年前曾發生左側腦中風',
    reveal_if: ['詢問過去病史', '詢問中風／神經病史'],
    do_not_volunteer: true
  };
  $('casePreview').textContent = JSON.stringify(casePreview, null, 2);
  const rubric = [
    ['主要語言困擾', 15], ['發作時間與病程', 10], ['中風／神經病史', 15], ['語言理解', 10],
    ['表達／找詞', 15], ['閱讀與書寫', 10], ['吞嚥初篩', 10], ['生活參與影響', 10], ['病人目標', 5]
  ];
  $('teacherRubric').innerHTML = rubric.map(([label, points]) => `<div class="teacher-item"><strong>${label}</strong><span>${points} 分</span></div>`).join('');
}

$('chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('messageInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  sendMessage(message);
});
$('finishBtn').addEventListener('click', evaluate);
$('resetBtn').addEventListener('click', reset);

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    button.classList.add('active');
    $(button.dataset.tab).classList.add('active');
  });
});

init();
