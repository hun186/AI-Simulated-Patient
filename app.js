const SESSION_KEY = 'ai-simulated-patient-poc-session-v2';
const CUSTOM_CASES_KEY = 'ai-simulated-patient-custom-cases-v1';
const RECORDS_KEY = 'ai-simulated-patient-records-v1';

const state = {
  caseId: 'aphasia_001',
  caseData: null,
  cases: [],
  transcript: [],
  revealedFactIds: [],
  sessionId: null,
  sessionStartedAt: null,
  studentName: '',
  customCases: [],
  records: []
};

const $ = (id) => document.getElementById(id);
const escapeHtml = (text) => String(text ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function loadPersistentData() {
  state.customCases = readJson(CUSTOM_CASES_KEY, []);
  state.records = readJson(RECORDS_KEY, []);
}

function currentCaseDefinition() {
  return state.customCases.find((item) => item.id === state.caseId) ?? null;
}

function saveSession() {
  writeJson(SESSION_KEY, {
    caseId: state.caseId,
    transcript: state.transcript,
    revealedFactIds: state.revealedFactIds,
    sessionId: state.sessionId,
    sessionStartedAt: state.sessionStartedAt,
    studentName: state.studentName
  });
}

function loadSession() {
  const saved = readJson(SESSION_KEY, null);
  if (!saved || !state.cases.some((item) => item.id === saved.caseId)) return false;
  state.caseId = saved.caseId;
  state.caseData = state.cases.find((item) => item.id === saved.caseId);
  state.transcript = Array.isArray(saved.transcript) ? saved.transcript : [];
  state.revealedFactIds = Array.isArray(saved.revealedFactIds) ? saved.revealedFactIds : [];
  state.sessionId = saved.sessionId || uid('session');
  state.sessionStartedAt = saved.sessionStartedAt || new Date().toISOString();
  state.studentName = saved.studentName || '';
  return true;
}

function beginSession() {
  state.sessionId = uid('session');
  state.sessionStartedAt = new Date().toISOString();
  state.transcript = [{ role:'patient', content:state.caseData.opening, at:new Date().toISOString() }];
  state.revealedFactIds = [];
  $('resultCard').classList.add('hidden');
  saveSession();
  renderStudentHeader();
  renderChat();
}

function renderCaseOptions() {
  $('caseSelect').innerHTML = state.cases.map((item) =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}${item.source === 'custom' ? '（教師建立）' : ''}</option>`
  ).join('');
  $('caseSelect').value = state.caseId;
}

function renderStudentHeader() {
  if (!state.caseData) return;
  $('caseTitle').textContent = state.caseData.title;
  $('caseBrief').textContent = state.caseData.publicBrief || '';
  $('difficultyBadge').textContent = state.caseData.difficulty || '自訂';
  $('patientSummary').textContent = `${state.caseData.patient?.name || '模擬病人'}，${state.caseData.patient?.age || '--'} 歲`;
  $('caseSelect').value = state.caseId;
  $('studentName').value = state.studentName;
}

function addMessage(role, content) {
  state.transcript.push({ role, content, at:new Date().toISOString() });
  saveSession();
  renderChat();
}

function renderChat() {
  const chat = $('chat');
  chat.innerHTML = '';
  for (const msg of state.transcript) {
    const wrap = document.createElement('div');
    wrap.className = `message ${msg.role === 'student' ? 'student' : 'patient'}`;
    wrap.innerHTML = `<div class="bubble"><div class="role">${msg.role === 'student' ? '學生' : '模擬病人'}</div><div>${escapeHtml(msg.content)}</div></div>`;
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
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({
        caseId:state.caseId,
        caseDefinition:currentCaseDefinition(),
        message,
        revealedFactIds:state.revealedFactIds
      })
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

function renderEvaluation(data) {
  $('resultCard').classList.remove('hidden');
  $('scoreCircle').textContent = `${data.percentage}`;
  $('feedback').innerHTML = `<ul class="feedback-list">${data.feedback.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p class="hint">${escapeHtml(data.note)}</p>`;
  $('rubricTable').innerHTML = data.items.map((item) => `
    <div class="rubric-row">
      <strong>${escapeHtml(item.criterion)}</strong>
      <span>${item.score} / ${item.maxScore}</span>
      <span class="${item.status === 'covered' ? 'ok' : 'miss'}">${item.status === 'covered' ? '已涵蓋' : '未涵蓋'}</span>
    </div>`).join('');
}

function archiveRecord(evaluation) {
  const record = {
    id:state.sessionId,
    studentName:state.studentName.trim() || '未填姓名',
    caseId:state.caseId,
    caseTitle:state.caseData.title,
    startedAt:state.sessionStartedAt,
    completedAt:new Date().toISOString(),
    transcript:state.transcript,
    revealedFactIds:state.revealedFactIds,
    evaluation
  };
  const existing = state.records.findIndex((item) => item.id === record.id);
  if (existing >= 0) state.records[existing] = record; else state.records.unshift(record);
  writeJson(RECORDS_KEY, state.records);
  renderRecords();
}

async function evaluate() {
  const res = await fetch('/api/evaluate', {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({
      caseId:state.caseId,
      caseDefinition:currentCaseDefinition(),
      transcript:state.transcript,
      revealedFactIds:state.revealedFactIds
    })
  });
  if (!res.ok) return alert('評分失敗');
  const data = await res.json();
  renderEvaluation(data);
  archiveRecord(data);
  $('resultCard').scrollIntoView({ behavior:'smooth', block:'start' });
}

function switchCase(caseId) {
  const next = state.cases.find((item) => item.id === caseId);
  if (!next) return;
  state.caseId = next.id;
  state.caseData = next;
  beginSession();
}

function renderTeacherCaseList() {
  const list = $('teacherCaseList');
  const items = state.cases.map((item) => {
    const custom = item.source === 'custom';
    return `<div class="manage-row">
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.patient?.name || '')} · ${escapeHtml(item.difficulty || '')}${custom ? ' · 教師建立' : ' · 系統內建'}</small></div>
      <div class="row-actions">
        ${custom ? `<button class="small-btn" data-edit-case="${escapeHtml(item.id)}">編輯</button><button class="small-btn danger" data-delete-case="${escapeHtml(item.id)}">刪除</button>` : '<span class="readonly-pill">唯讀</span>'}
      </div>
    </div>`;
  }).join('');
  list.innerHTML = items || '<p class="empty">尚無病例。</p>';
  list.querySelectorAll('[data-edit-case]').forEach((button) => button.addEventListener('click', () => openCaseEditor(button.dataset.editCase)));
  list.querySelectorAll('[data-delete-case]').forEach((button) => button.addEventListener('click', () => deleteCase(button.dataset.deleteCase)));
}

function emptyCaseDraft() {
  return {
    id:'', title:'', difficulty:'入門', publicBrief:'',
    patient:{ name:'', age:60, gender:'', persona:'' },
    opening:'你好。', facts:[], rubric:[]
  };
}

function openCaseEditor(caseId = null) {
  const source = caseId ? state.customCases.find((item) => item.id === caseId) : emptyCaseDraft();
  if (!source) return;
  $('caseEditor').classList.remove('hidden');
  $('caseEditorTitle').textContent = caseId ? '編輯病例' : '新增病例';
  $('editCaseId').value = source.id || '';
  $('editTitle').value = source.title || '';
  $('editDifficulty').value = source.difficulty || '入門';
  $('editBrief').value = source.publicBrief || '';
  $('editPatientName').value = source.patient?.name || '';
  $('editPatientAge').value = source.patient?.age || '';
  $('editPatientGender').value = source.patient?.gender || '';
  $('editPersona').value = source.patient?.persona || '';
  $('editOpening').value = source.opening || '';
  $('factRows').innerHTML = '';
  const pointsByFact = new Map((source.rubric || []).flatMap((rubric) => (rubric.factIds || []).map((id) => [id, rubric.points])));
  (source.facts || []).forEach((fact) => addFactRow({ ...fact, points:pointsByFact.get(fact.id) || 0 }));
  if (!(source.facts || []).length) addFactRow();
  $('caseEditor').scrollIntoView({ behavior:'smooth', block:'start' });
}

function addFactRow(fact = {}) {
  const row = document.createElement('div');
  row.className = 'fact-editor-row';
  row.dataset.factId = fact.id || uid('fact');
  row.innerHTML = `
    <div class="fact-row-head"><strong>病例資訊項目</strong><button type="button" class="link-danger remove-fact">移除</button></div>
    <label>項目名稱<input class="fact-label" value="${escapeHtml(fact.label || '')}" placeholder="例如：喝水嗆咳"></label>
    <label>病人回答<textarea class="fact-value" rows="2" placeholder="學生問到後，病人才可透露的資訊">${escapeHtml(fact.value || '')}</textarea></label>
    <div class="form-grid compact">
      <label>觸發關鍵字<input class="fact-triggers" value="${escapeHtml((fact.triggers || []).join('、'))}" placeholder="喝水、嗆、液體"></label>
      <label>配分<input class="fact-points" type="number" min="0" max="100" value="${Number(fact.points) || 0}"></label>
    </div>`;
  row.querySelector('.remove-fact').addEventListener('click', () => row.remove());
  $('factRows').append(row);
}

function saveCaseFromEditor(event) {
  event.preventDefault();
  const rows = [...$('factRows').querySelectorAll('.fact-editor-row')];
  const facts = rows.map((row, index) => {
    const id = row.dataset.factId || `fact_${index + 1}`;
    return {
      id,
      label:row.querySelector('.fact-label').value.trim(),
      category:'teacher_defined',
      value:row.querySelector('.fact-value').value.trim(),
      triggers:row.querySelector('.fact-triggers').value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
      mayVolunteer:false,
      points:Number(row.querySelector('.fact-points').value) || 0
    };
  }).filter((fact) => fact.label && fact.value && fact.triggers.length);

  if (!facts.length) return alert('至少需要一個完整的病例資訊項目（名稱、回答、觸發關鍵字）。');
  const originalId = $('editCaseId').value;
  const id = originalId || uid('case');
  const caseDef = {
    id,
    title:$('editTitle').value.trim(),
    difficulty:$('editDifficulty').value.trim() || '自訂',
    publicBrief:$('editBrief').value.trim(),
    patient:{
      name:$('editPatientName').value.trim(),
      age:Number($('editPatientAge').value) || 0,
      gender:$('editPatientGender').value.trim(),
      persona:$('editPersona').value.trim()
    },
    opening:$('editOpening').value.trim(),
    facts:facts.map(({ points, ...fact }) => fact),
    rubric:facts.filter((fact) => fact.points > 0).map((fact) => ({ id:`rubric_${fact.id}`, label:fact.label, factIds:[fact.id], points:fact.points })),
    source:'custom',
    updatedAt:new Date().toISOString()
  };
  if (!caseDef.title || !caseDef.patient.name || !caseDef.opening) return alert('請填寫病例名稱、病人姓名與開場白。');
  const index = state.customCases.findIndex((item) => item.id === id);
  if (index >= 0) state.customCases[index] = caseDef; else state.customCases.push(caseDef);
  writeJson(CUSTOM_CASES_KEY, state.customCases);
  rebuildCases();
  $('caseEditor').classList.add('hidden');
  renderTeacherCaseList();
  renderCaseOptions();
}

function deleteCase(caseId) {
  const item = state.customCases.find((x) => x.id === caseId);
  if (!item || !confirm(`確定刪除病例「${item.title}」？既有學生作答紀錄不會被刪除。`)) return;
  state.customCases = state.customCases.filter((x) => x.id !== caseId);
  writeJson(CUSTOM_CASES_KEY, state.customCases);
  rebuildCases();
  if (state.caseId === caseId) switchCase('aphasia_001');
  renderTeacherCaseList();
  renderCaseOptions();
}

function rebuildCases() {
  const builtIns = state.cases.filter((item) => item.source !== 'custom');
  state.cases = [...builtIns, ...state.customCases.map((item) => ({ ...item, source:'custom' }))];
}

function renderRecords() {
  $('recordCount').textContent = state.records.length;
  const scored = state.records.filter((r) => Number.isFinite(r.evaluation?.percentage));
  $('averageScore').textContent = scored.length ? `${Math.round(scored.reduce((s, r) => s + r.evaluation.percentage, 0) / scored.length)}%` : '--';
  const list = $('recordList');
  list.innerHTML = state.records.length ? state.records.map((record) => `
    <button class="record-row" data-record-id="${escapeHtml(record.id)}">
      <span><strong>${escapeHtml(record.studentName)}</strong><small>${escapeHtml(record.caseTitle)}</small></span>
      <span>${new Date(record.completedAt).toLocaleString('zh-TW')}</span>
      <b>${record.evaluation?.percentage ?? '--'}%</b>
    </button>`).join('') : '<p class="empty">目前還沒有完成的學生問診紀錄。學生按「結束問診並評分」後會自動出現在這裡。</p>';
  list.querySelectorAll('[data-record-id]').forEach((button) => button.addEventListener('click', () => showRecord(button.dataset.recordId)));
}

function showRecord(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  $('recordDetail').classList.remove('hidden');
  $('recordDetailTitle').textContent = `${record.studentName} · ${record.caseTitle}`;
  $('recordMeta').textContent = `${new Date(record.completedAt).toLocaleString('zh-TW')} · ${record.transcript.filter((m) => m.role === 'student').length} 個學生提問 · ${record.evaluation?.percentage ?? '--'} 分`;
  $('recordTranscript').innerHTML = record.transcript.map((m) => `<div class="audit-turn ${m.role}"><strong>${m.role === 'student' ? '學生' : '病人'}</strong><span>${escapeHtml(m.content)}</span></div>`).join('');
  $('recordRubric').innerHTML = (record.evaluation?.items || []).map((item) => `<div class="teacher-item"><strong>${escapeHtml(item.criterion)}</strong><span>${item.score}/${item.maxScore} · ${item.status === 'covered' ? '已涵蓋' : '未涵蓋'}</span></div>`).join('');
  $('downloadRecordBtn').onclick = () => downloadJson(`interview-${record.id}.json`, record);
  $('deleteRecordBtn').onclick = () => {
    if (!confirm('確定刪除這筆作答紀錄？')) return;
    state.records = state.records.filter((item) => item.id !== record.id);
    writeJson(RECORDS_KEY, state.records);
    $('recordDetail').classList.add('hidden');
    renderRecords();
  };
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function switchTeacherView(view) {
  document.querySelectorAll('.teacher-subtab').forEach((button) => button.classList.toggle('active', button.dataset.teacherView === view));
  document.querySelectorAll('.teacher-view').forEach((panel) => panel.classList.toggle('active', panel.id === `teacher-${view}`));
  if (view === 'records') renderRecords();
}

async function init() {
  loadPersistentData();
  const res = await fetch('/api/cases');
  const data = await res.json();
  const builtIns = data.cases.map((item) => ({ ...item, source:'builtin' }));
  state.cases = [...builtIns, ...state.customCases.map((item) => ({ ...item, source:'custom' }))];
  state.caseId = state.cases[0]?.id || 'aphasia_001';
  state.caseData = state.cases[0];
  renderCaseOptions();
  if (!loadSession()) beginSession();
  renderStudentHeader();
  renderChat();
  renderTeacherCaseList();
  renderRecords();
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
$('resetBtn').addEventListener('click', beginSession);
$('caseSelect').addEventListener('change', (event) => switchCase(event.target.value));
$('studentName').addEventListener('input', (event) => { state.studentName = event.target.value; saveSession(); });
$('newCaseBtn').addEventListener('click', () => openCaseEditor());
$('addFactBtn').addEventListener('click', () => addFactRow());
$('cancelCaseBtn').addEventListener('click', () => $('caseEditor').classList.add('hidden'));
$('caseEditorForm').addEventListener('submit', saveCaseFromEditor);
$('closeRecordBtn').addEventListener('click', () => $('recordDetail').classList.add('hidden'));

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    button.classList.add('active');
    $(button.dataset.tab).classList.add('active');
  });
});
document.querySelectorAll('.teacher-subtab').forEach((button) => button.addEventListener('click', () => switchTeacherView(button.dataset.teacherView)));

init();
