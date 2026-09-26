const SKEY='aisp-formal-session-v1',RKEY='aisp-formal-records-v1',CKEY='aisp-formal-custom-cases-v1',DKEY='aisp-vercel-demo-user-v1';
const state={serverMode:false,demoAuth:false,user:null,csrfToken:null,needsAdminMigration:false,cases:[],teacherCases:[],caseId:'aphasia_001',caseData:null,mode:'training',studentName:'',transcript:[],revealedFactIds:[],sessionId:null,records:[],coach:null,coachEnabled:false,coachUsed:false,customCases:[],aiSettings:null,usageDashboard:null};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid=()=> 'session_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const modeLabel=m=>m==='exam'?'考試評量':'訓練學習';
const currentCaseDefinition=()=>state.customCases.find(c=>c.id===state.caseId)||null;

function save(){if(state.serverMode)return;write(SKEY,{caseId:state.caseId,mode:state.mode,studentName:state.studentName,transcript:state.transcript,revealedFactIds:state.revealedFactIds,sessionId:state.sessionId,coach:state.coach,coachEnabled:state.coachEnabled,coachUsed:state.coachUsed});}
async function start(){
  state.revealedFactIds=[];state.coach=null;state.coachUsed=state.mode==='training'&&state.coachEnabled;
  $('resultCard').classList.add('hidden');
  if(state.serverMode){
    const d=await post('/api/sessions',{caseId:state.caseId,mode:state.mode,coachEnabled:state.coachEnabled});
    state.sessionId=d.session.id;
    state.transcript=[{role:'patient',content:d.session.opening,at:new Date().toISOString()}];
  }else{
    state.sessionId=uid();
    state.transcript=[{role:'patient',content:state.caseData.opening,at:new Date().toISOString()}];
  }
  save();renderAll();
}
function renderAll(){renderHeader();renderMode();renderChat();renderCoach();}
function renderHeader(){$('caseSelect').value=state.caseId;$('modeSelect').value=state.mode;$('coachToggle').value=state.coachEnabled?'on':'off';$('studentName').value=state.studentName;$('caseTitle').textContent=state.caseData.studentLabel||'臨床問診案例';$('caseBrief').textContent=state.caseData.studentBrief||state.caseData.publicBrief||'';$('difficultyBadge').textContent=state.caseData.difficulty||'自訂';$('patientSummary').textContent=(state.caseData.patient?.name||'模擬病人')+'，'+(state.caseData.patient?.age||'--')+' 歲';}
function renderMode(){const training=state.mode==='training';const coachOn=training&&state.coachEnabled;$('modeBanner').className='mode-banner '+(training?'training':'exam');$('modeBadge').textContent=training?'TRAINING':'EXAM';$('modeTitle').textContent=training?'訓練學習模式':'考試評量模式';$('modeDescription').textContent=training?(coachOn?'AI Coach 已開啟：每輪提供問句品質與非洩題方向提示。':'AI Coach 已關閉：純自主練習，不顯示即時提示或涵蓋進度；結束後仍會產生完整總評。'):'不提供即時提示、不顯示評量進度；結束後才產生完整評量與總評。';$('coachToggle').disabled=!training;$('coachControl').classList.toggle('disabled',!training);$('coachCard').classList.toggle('hidden',!coachOn);$('trainingProgressMetric').classList.toggle('hidden',!coachOn);$('coachOffNotice').classList.toggle('hidden',!training||coachOn);$('examProgressHidden').classList.toggle('hidden',training);}
function renderChat(){const c=$('chat');c.innerHTML=state.transcript.map(m=>'<div class="message '+(m.role==='student'?'student':'patient')+'"><div class="bubble"><div class="role">'+(m.role==='student'?'學生':'模擬病人')+'</div><div>'+esc(m.content)+'</div></div></div>').join('');c.scrollTop=c.scrollHeight;$('turnCount').textContent=state.transcript.filter(m=>m.role==='student').length;}
function renderCoach(d=state.coach){if(state.mode!=='training'||!state.coachEnabled)return;$('coachEmpty').classList.toggle('hidden',!!d);$('coachContent').classList.toggle('hidden',!d);if(!d){$('trainingProgress').textContent='0/?';return}$('trainingProgress').textContent=d.progress.covered+'/'+d.progress.total;$('coachQuality').textContent=d.lastQuestion?.level==='good'?'問句品質良好':'可再精進';$('coachQuality').className=d.lastQuestion?.level==='good'?'quality-good':'quality-needs';$('coachComment').textContent=d.lastQuestion?.comment||'';$('coachHint').textContent=d.nextHint;$('coachReflection').textContent=d.reflectionPrompt;}
async function post(url,payload){
  const headers={'content-type':'application/json'};
  if(state.serverMode&&state.csrfToken)headers['x-csrf-token']=state.csrfToken;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)});
  const text=await r.text();
  let data={};
  if(text){try{data=JSON.parse(text);}catch{data={error:text};}}
  if(!r.ok){
    const error=new Error(data.error||data.message||('HTTP '+r.status));
    error.status=r.status;
    error.retryAfter=Number(r.headers.get('Retry-After')||0);
    error.details=data;
    throw error;
  }
  return data;
}
async function ask(q){state.transcript.push({role:'student',content:q,at:new Date().toISOString()});renderChat();$('sendBtn').disabled=true;try{const d=await post('/api/chat',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,message:q,revealedFactIds:state.serverMode?[]:state.revealedFactIds});if(!state.serverMode)state.revealedFactIds=d.revealedFactIds;state.transcript.push({role:'patient',content:d.reply,at:new Date().toISOString()});if(state.mode==='training'&&state.coachEnabled){state.coach=await post('/api/coach',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,transcript:state.transcript,revealedFactIds:state.serverMode?[]:state.revealedFactIds});state.coachUsed=true;}save();renderChat();renderMode();renderCoach();}catch{state.transcript.push({role:'patient',content:'（系統暫時無法取得回覆。）'});renderChat();}finally{$('sendBtn').disabled=false;}}
function renderEvaluation(d){$('resultCard').classList.remove('hidden');$('scoreCircle').textContent=String(d.percentage);$('resultMode').textContent=modeLabel(d.mode)+' · '+d.totalScore+'/'+d.maxScore+' 分';$('overallComment').textContent=d.overall.comment;$('strengthList').innerHTML=d.overall.strengths.map(x=>'<li>'+esc(x)+'</li>').join('');$('improvementList').innerHTML=d.overall.improvements.map(x=>'<li>'+esc(x)+'</li>').join('');$('recommendationList').innerHTML=d.overall.recommendations.map(x=>'<li>'+esc(x)+'</li>').join('');$('nextPracticeFocus').textContent=d.overall.nextPracticeFocus;$('rubricTable').innerHTML=d.items.map(i=>'<div class="rubric-item"><div class="rubric-main"><strong>'+esc(i.criterion)+'</strong><span>'+i.score+'/'+i.maxScore+'</span><span class="status status-'+i.status+'">'+(i.status==='covered'?'完整涵蓋':i.status==='partial'?'部分涵蓋':'未涵蓋')+'</span></div><div class="rubric-detail"><span>'+esc(i.reasoning)+'</span>'+(i.evidence?.[0]?'<span class="evidence-quote">證據：「'+esc(i.evidence[0].quote)+'」</span>':'')+'</div></div>').join('');}
async function finish(){try{const d=await post('/api/evaluate',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,transcript:state.transcript,revealedFactIds:state.revealedFactIds,mode:state.mode});renderEvaluation(d);if(state.serverMode){if(['teacher','admin'].includes(state.user?.role))await renderRecords();return;}const rec={id:state.sessionId,studentName:state.studentName||'未填姓名',caseTitle:state.caseData.studentLabel||state.caseData.title||'臨床問診案例',mode:state.mode,coachUsed:state.mode==='training'&&state.coachUsed,completedAt:new Date().toISOString(),transcript:state.transcript,evaluation:d};state.records=read(RKEY,[]);const ix=state.records.findIndex(x=>x.id===rec.id);if(ix>=0)state.records[ix]=rec;else state.records.unshift(rec);write(RKEY,state.records);renderRecords();}catch{alert('評量失敗');}}
function renderCases(){const list=state.teacherCases.length?state.teacherCases:state.customCases;$('teacherCaseList').innerHTML=list.length?list.map(c=>'<div class="manage-row"><div><strong>'+esc(c.internalTitle||c.title||'未命名病例')+'</strong><small>學生看到：'+esc(c.studentLabel||'臨床問診案例')+' · '+esc(c.patient?.name||'')+' · '+esc(c.difficulty||'')+' · '+(c.learningGoals||[]).length+' 個學習目標</small></div><span class="readonly-pill">'+(c.source==='custom'?'教師建立':'系統內建')+'</span></div>').join(''):'<p class="empty">尚無病例。</p>';}
async function renderRecords(){if(state.serverMode){if(!['teacher','admin'].includes(state.user?.role))return;try{
  const rows=(await fetch('/api/teacher/records').then(r=>r.json())).records||[];
  state.records=rows.map(r=>({...r,percentage:Number(r.percentage),completedAt:r.endedAt||r.startedAt,coachUsed:Boolean(r.coachUsed),evaluation:r.evaluation||{percentage:Number(r.percentage),items:[]},transcript:r.transcript||[]}));
}catch{state.records=[];}}else state.records=read(RKEY,[]);$('recordCount').textContent=state.records.length;$('trainingCount').textContent=state.records.filter(r=>r.mode==='training').length;$('examCount').textContent=state.records.filter(r=>r.mode==='exam').length;const scored=state.records.filter(r=>Number.isFinite(r.evaluation?.percentage));$('averageScore').textContent=scored.length?Math.round(scored.reduce((a,r)=>a+r.evaluation.percentage,0)/scored.length)+'%':'--';$('recordList').innerHTML=state.records.length?state.records.map(r=>'<button class="record-row" data-id="'+esc(r.id)+'"><span><strong>'+esc(r.studentName)+'</strong><small>'+esc(r.caseTitle)+'</small></span><span class="record-mode '+r.mode+'">'+(r.mode==='training'?'訓練':'考試')+'</span><span>'+new Date(r.completedAt).toLocaleString('zh-TW')+'</span><b>'+(r.evaluation?.percentage??'--')+'%</b></button>').join(''):'<p class="empty">尚無完成紀錄。</p>';$('recordList').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>showRecord(b.dataset.id));}
function showRecord(id){const r=state.records.find(x=>x.id===id);if(!r)return;$('recordDetail').classList.remove('hidden');$('recordDetailTitle').textContent=r.studentName+' · '+r.caseTitle;$('recordMeta').textContent=modeLabel(r.mode)+(r.mode==='training'?' · Coach '+(r.coachUsed?'曾開啟':'未使用'):'')+' · '+new Date(r.completedAt).toLocaleString('zh-TW')+' · '+r.evaluation.percentage+' 分';$('recordOverall').innerHTML='<strong>AI 總評</strong><p>'+esc(r.evaluation.overall?.comment||'')+'</p>';$('recordTranscript').innerHTML=r.transcript.map(m=>'<div class="audit-turn '+m.role+'"><strong>'+(m.role==='student'?'學生':'病人')+'</strong><span>'+esc(m.content)+'</span></div>').join('');$('recordRubric').innerHTML=r.evaluation.items.map(i=>'<div class="teacher-item"><strong>'+esc(i.criterion)+'</strong><span>'+i.score+'/'+i.maxScore+' · '+(i.status==='covered'?'完整':i.status==='partial'?'部分':'未涵蓋')+'</span></div>').join('');}
function switchMode(m){if(m===state.mode)return;if(!confirm('切換模式會重新開始本病例，確定嗎？')){$('modeSelect').value=state.mode;return}state.mode=m;if(m==='exam'){state.coachEnabled=false;state.coach=null;}start();}
function switchCase(id){const c=state.cases.find(x=>x.id===id);if(!c)return;state.caseId=id;state.caseData=c;start();}
async function loadApplication(){
  state.records=state.serverMode?[]:read(RKEY,[]);
  state.customCases=state.serverMode?[]:read(CKEY,[]);
  const r=await fetch('/api/cases');
  if(r.status===401){showLogin();return;}
  const d=await r.json();
  state.cases=[...d.cases.map(c=>({...c,source:'builtin'})),...state.customCases.map(c=>({...c,source:'custom'}))];
  state.caseData=state.cases[0];
  state.caseId=state.caseData?.id||'aphasia_001';
  $('caseSelect').innerHTML=state.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.studentLabel||'臨床問診案例')+(c.source==='custom'?'（教師建立）':'')+'</option>').join('');
  const staff=state.demoAuth?['teacher','admin'].includes(state.user?.role):(!state.serverMode||['teacher','admin'].includes(state.user?.role));document.querySelector('[data-tab="teacher"]').classList.toggle('hidden',!staff);document.querySelector('[data-view="users"]').classList.toggle('hidden',!state.serverMode||!staff);document.querySelector('[data-view="ai"]').classList.toggle('hidden',!state.serverMode||!staff);document.querySelector('[data-view="usage"]').classList.toggle('hidden',!state.serverMode||!staff);document.querySelector('[data-view="audit"]').classList.toggle('hidden',!state.serverMode||state.user?.role!=='admin');$('studentName').disabled=state.serverMode||state.demoAuth;
  $('runtimeStatus').textContent=state.serverMode
    ?'Server DB · '+(state.user?.displayName||'')+' · '+(state.user?.role||'')
    :state.demoAuth
      ?'Vercel PoC · '+(state.user?.displayName||'Demo')+' · '+(state.user?.role||'')
      :'Demo · Browser local';
  $('logoutBtn').classList.toggle('hidden',!state.serverMode&&!state.demoAuth);$('changePasswordBtn').classList.toggle('hidden',!state.serverMode);
  if(state.user?.displayName) state.studentName=state.user.displayName;
  renderRecords();await start();
}
function hideAuthCards(){
  ['demoLoginForm','loginForm','registerForm','bootstrapForm'].forEach(id=>$(id)?.classList.add('hidden'));
}
function showLogin(message=''){
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  hideAuthCards();$('loginForm').classList.remove('hidden');
  $('loginError').textContent=message;
}
function showDemoLogin(){
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  hideAuthCards();$('demoLoginForm').classList.remove('hidden');
}
async function demoLogin(role){
  const profiles={
    student:{id:'demo-student',email:'student@demo.local',displayName:'示範學生',role:'student',accountStatus:'active'},
    teacher:{id:'demo-teacher',email:'teacher@demo.local',displayName:'示範教師',role:'teacher',accountStatus:'active'},
    admin:{id:'demo-admin',email:'admin@demo.local',displayName:'示範管理員',role:'admin',accountStatus:'active'}
  };
  state.user=profiles[role]||profiles.student;
  write(DKEY,state.user);
  $('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');
  await loadApplication();
}
function showBootstrap(message='',migration=false){
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  hideAuthCards();$('bootstrapForm').classList.remove('hidden');
  $('bootstrapTitle').textContent=migration?'升級現有帳號為系統管理員':'建立第一位系統管理員';
  $('bootstrapHelp').textContent=migration?'資料庫已有舊版帳號但尚無 admin。請輸入既有帳號密碼與 Setup Key 完成一次性升級。':'偵測到資料庫尚無帳號。此步驟只會成功一次。';
  $('bootstrapNameRow').classList.toggle('hidden',migration);
  $('bootstrapError').textContent=message;
}
function showRegister(role='student'){
  const teacher=role==='teacher';
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  hideAuthCards();$('registerForm').classList.remove('hidden');
  $('registerRole').value=teacher?'teacher':'student';
  $('registerEyebrow').textContent=teacher?'Teacher Registration':'Student Registration';
  $('registerTitle').textContent=teacher?'申請教師帳號':'申請學生帳號';
  $('registerHelp').textContent=teacher
    ?'密碼由你自行設定；系統管理員不會看到你的原始密碼。教師申請只能由系統管理員核准，核准前無法登入。'
    :'密碼由你自行設定；教師與系統管理員不會看到你的原始密碼。申請送出後需先核准才能登入。';
  $('registerTeacherRow').classList.toggle('hidden',teacher);
  if(teacher)$('registerTeacherEmail').value='';
  $('registerMessage').textContent='';
  $('registerMessage').className='auth-message';
}
async function registerAccount(event){
  event.preventDefault();
  const displayName=$('registerName').value.trim();
  const email=$('registerEmail').value.trim();
  const password=$('registerPassword').value;
  const confirmPassword=$('registerPasswordConfirm').value;
  const role=$('registerRole').value==='teacher'?'teacher':'student';
  const requestedTeacherEmail=role==='student'?$('registerTeacherEmail').value.trim():'';

  const showError=message=>{
    $('registerMessage').textContent=message;
    $('registerMessage').className='auth-message auth-error';
  };

  if(!displayName)return showError('請輸入姓名。');
  if(!email || !/^[^\s@]+@[^\s@]+$/.test(email))return showError('請輸入有效的 Email，例如 student@example.com。');
  if(password.length<12)return showError('密碼至少需要 12 個字元。');
  if(password.length>256)return showError('密碼不可超過 256 個字元。');
  if(password!==confirmPassword)return showError('兩次輸入的密碼不一致。');
  if(requestedTeacherEmail && !/^[^\s@]+@[^\s@]+$/.test(requestedTeacherEmail)){
    return showError('指導教師 Email 格式不正確；若不確定可留空，由系統管理員處理。');
  }

  try{
    const d=await post('/api/auth/register',{displayName,email,password,role,requestedTeacherEmail});
    $('registerForm').reset();
    $('registerMessage').textContent=d.message||'申請已送出，請等待核准。';
    $('registerMessage').className='auth-message auth-success';
  }catch(error){
    let message=error.message||'申請無法送出。';
    if(error.status===429 && error.retryAfter){
      message='申請次數過多，請約 '+error.retryAfter+' 秒後再試。';
    }else if(error.status===500){
      message='伺服器處理申請時發生錯誤。請查看執行 npm run dev 的視窗是否有錯誤訊息。';
    }
    showError(message);
  }
}
async function init(){
  try{
    const runtime=await fetch('/api/runtime').then(r=>r.json());
    state.serverMode=runtime.persistence!=='browser';
    state.demoAuth=Boolean(runtime.demoAuth);
    if(state.demoAuth){
      const saved=read(DKEY,null);
      if(!saved){showDemoLogin();return;}
      state.user=saved;
    }else if(state.serverMode){
      state.needsAdminMigration=Boolean(runtime.needsAdminMigration);
      if(runtime.needsBootstrap||runtime.needsAdminMigration){showBootstrap('',runtime.needsAdminMigration);return;}
      const me=await fetch('/api/auth/me');
      if(!me.ok){showLogin();return;}
      const meData=await me.json();
      state.user=meData.user;state.csrfToken=meData.csrfToken;
    }
    $('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');
    await loadApplication();
  }catch(error){console.error(error);showLogin('系統初始化失敗，請檢查伺服器與資料庫設定。');}
}
async function login(event){
  event.preventDefault();
  try{
    const d=await post('/api/auth/login',{email:$('loginEmail').value.trim(),password:$('loginPassword').value});
    state.user=d.user;state.csrfToken=d.csrfToken;$('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');await loadApplication();
  }catch{$('loginError').textContent='登入失敗，請檢查帳號密碼。';}
}
async function bootstrap(event){
  event.preventDefault();
  try{
    const d=await post('/api/auth/bootstrap',{
      setupKey:$('bootstrapKey').value,
      email:$('bootstrapEmail').value.trim(),
      password:$('bootstrapPassword').value,
      displayName:$('bootstrapName').value.trim()||'Administrator',
      promoteExisting:state.needsAdminMigration
    });
    state.user=d.user;state.csrfToken=d.csrfToken;
    $('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');
    await loadApplication();
  }catch{$('bootstrapError').textContent='建立/升級失敗；請確認 schema、Setup Key 與帳號密碼，且新密碼至少 12 個字元。';}
}
async function logout(){
  if(state.demoAuth){localStorage.removeItem(DKEY);location.reload();return;}
  if(state.serverMode)await post('/api/auth/logout',{});
  location.reload();
}
$('chatForm').onsubmit=e=>{e.preventDefault();const i=$('messageInput'),q=i.value.trim();if(!q)return;i.value='';ask(q);};
async function setCoachEnabled(enabled){
  if(state.mode!=='training'){state.coachEnabled=false;$('coachToggle').value='off';return;}
  if(state.serverMode&&state.sessionId){
    try{await post('/api/sessions',{action:'setCoach',sessionId:state.sessionId,coachEnabled:enabled});}
    catch{$('coachToggle').value=state.coachEnabled?'on':'off';alert('Coach 設定同步失敗，請稍後再試。');return;}
  }
  state.coachEnabled=enabled;
  if(!enabled){state.coach=null;save();renderMode();renderCoach();return;}
  state.coachUsed=true;
  const hasQuestion=state.transcript.some(m=>m.role==='student');
  if(hasQuestion){
    try{state.coach=await post('/api/coach',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,transcript:state.transcript,revealedFactIds:state.serverMode?[]:state.revealedFactIds});}
    catch{state.coach=null;}
  }
  save();renderMode();renderCoach();
}
$('finishBtn').onclick=finish;$('resetBtn').onclick=start;$('caseSelect').onchange=e=>switchCase(e.target.value);$('modeSelect').onchange=e=>switchMode(e.target.value);$('coachToggle').onchange=e=>setCoachEnabled(e.target.value==='on');$('studentName').oninput=e=>{if(state.serverMode)return;state.studentName=e.target.value;save();};$('closeRecordBtn').onclick=()=>$('recordDetail').classList.add('hidden');
const AI_AGENT_LABELS={patient:'Patient',coach:'Coach',evaluator:'Evaluator'};
function aiPresetOptions(){
  const items=state.user?.role==='admin'
    ?[['openai','OpenAI'],['deepseek','DeepSeek'],['ollama','Ollama'],['custom','OpenAI-compatible / Custom']]
    :[['openai','OpenAI'],['deepseek','DeepSeek']];
  return items.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
}
function syncAiPresetFields(){
  const preset=$('aiPreset').value;
  const showBase=state.user?.role==='admin'&&['ollama','custom'].includes(preset);
  $('aiBaseUrlRow').classList.toggle('hidden',!showBase);
  $('aiApiKey').required=['openai','deepseek'].includes(preset);
}
function manageableAiConnection(connection){
  return state.user?.role==='admin'||(connection.scopeType==='teacher'&&connection.ownerUserId===state.user?.id);
}
async function renderAiSettings(){
  if(!state.serverMode||!['teacher','admin'].includes(state.user?.role))return;
  if(!state.teacherCases.length)await loadTeacherCases();
  try{
    const response=await fetch('/api/teacher/ai-settings');
    if(!response.ok)throw new Error('ai-settings');
    const data=await response.json();
    state.aiSettings=data;
    $('aiPreset').innerHTML=aiPresetOptions();
    syncAiPresetFields();
    $('aiRestrictionNote').textContent=state.user?.role==='admin'
      ?'Admin 可建立系統級 OpenAI、DeepSeek、Ollama 與自訂 OpenAI-compatible 連線。'
      :'Teacher 僅能建立自己的 OpenAI / DeepSeek 連線；Ollama 與自訂私有端點由 Admin 管理。';

    $('aiConnectionList').innerHTML=(data.connections||[]).map(connection=>{
      const canManage=manageableAiConnection(connection);
      const key=connection.apiKeyLast4?'••••'+esc(connection.apiKeyLast4):'無 API Key';
      return '<div class="ai-provider-row"><div class="ai-provider-meta"><strong>'+esc(connection.name)+'</strong><small>'+
        esc(connection.preset)+' · '+esc(connection.defaultModel)+' · '+(connection.isActive?'啟用':'停用')+
        ' · <span class="ai-key-mask">'+key+'</span></small></div><div class="ai-provider-actions">'+
        (canManage?'<button class="small-btn" data-ai-edit="'+connection.id+'">編輯</button><button class="small-btn" data-ai-toggle="'+connection.id+'">'+(connection.isActive?'停用':'啟用')+'</button><button class="small-btn" data-ai-test="'+connection.id+'">測試連線</button><button class="small-btn danger-btn" data-ai-delete="'+connection.id+'">刪除</button>':'<span class="readonly-pill">系統提供</span>')+
        '</div></div>';
    }).join('')||'<p class="empty">尚未設定 AI Provider 連線。</p>';

    $('aiConnectionList').querySelectorAll('[data-ai-edit]').forEach(button=>button.onclick=()=>editAiConnection(button.dataset.aiEdit));
    $('aiConnectionList').querySelectorAll('[data-ai-toggle]').forEach(button=>button.onclick=()=>toggleAiConnection(button.dataset.aiToggle));
    $('aiConnectionList').querySelectorAll('[data-ai-test]').forEach(button=>button.onclick=()=>testAiConnection(button.dataset.aiTest));
    $('aiConnectionList').querySelectorAll('[data-ai-delete]').forEach(button=>button.onclick=()=>deleteAiConnection(button.dataset.aiDelete));

    const teacher=state.user?.role==='teacher';
    $('aiCaseRow').classList.toggle('hidden',!teacher);
    if(teacher){
      const ownedCases=(state.teacherCases||[]).filter(c=>c.createdBy===state.user?.id);
      $('aiCaseSelect').innerHTML=ownedCases.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.internalTitle||c.title||c.studentLabel||c.id)+'</option>').join('');
      if(!ownedCases.length){
        $('aiRouteGrid').innerHTML='<p class="empty">你目前沒有可設定 AI route 的自建病例。</p>';
        return;
      }
    }

    const usable=(data.connections||[]).filter(connection=>connection.isActive&&(state.user?.role==='admin'?connection.scopeType==='system':connection.scopeType==='teacher'&&connection.ownerUserId===state.user?.id));
    $('aiRouteGrid').innerHTML=['patient','coach','evaluator'].map(agent=>{
      const caseId=teacher?$('aiCaseSelect').value:null;
      const route=(data.routes||[]).find(r=>r.agentType===agent&&(teacher?(r.scopeType==='case'&&r.scopeId===caseId):r.scopeType==='system'));
      const options=usable.map(c=>'<option value="'+c.id+'" '+(route?.connectionId===c.id?'selected':'')+'>'+esc(c.name)+' · '+esc(c.defaultModel)+'</option>').join('');
      return '<section class="ai-route-card" data-agent="'+agent+'"><header><strong>'+AI_AGENT_LABELS[agent]+'</strong><small>'+(route?'已設定':'未設定')+'</small></header>'+
        '<label>Provider / Model<select class="ai-route-connection"><option value="">未設定</option>'+options+'</select></label>'+
        '<div class="ai-route-actions"><button class="secondary small-btn" type="button" data-ai-route-save="'+agent+'">儲存路由</button>'+
        (route?'<button class="small-btn danger-btn" type="button" data-ai-route-delete="'+route.id+'">移除</button>':'')+'</div></section>';
    }).join('');
    $('aiRouteGrid').querySelectorAll('[data-ai-route-save]').forEach(button=>button.onclick=()=>saveAiRoute(button.dataset.aiRouteSave));
    $('aiRouteGrid').querySelectorAll('[data-ai-route-delete]').forEach(button=>button.onclick=()=>deleteAiRoute(button.dataset.aiRouteDelete));
  }catch{
    $('aiConnectionList').innerHTML='<p class="empty">AI 設定讀取失敗。</p>';
    $('aiRouteGrid').innerHTML='';
  }
}
async function createAiConnection(event){
  event.preventDefault();
  const preset=$('aiPreset').value;
  const payload={
    action:'createConnection',name:$('aiConnectionName').value.trim(),preset,
    defaultModel:$('aiDefaultModel').value.trim(),apiKey:$('aiApiKey').value
  };
  if(state.user?.role==='admin'&&['ollama','custom'].includes(preset))payload.baseUrl=$('aiBaseUrl').value.trim();
  try{
    await post('/api/teacher/ai-settings',payload);
    $('aiConnectionForm').reset();$('aiApiKey').value='';await renderAiSettings();
  }catch(error){alert('AI Provider 建立失敗：'+(error.message||'請檢查設定與權限。'));}
}
async function editAiConnection(connectionId){
  const connection=(state.aiSettings?.connections||[]).find(c=>c.id===connectionId);
  if(!connection)return;
  const name=prompt('連線名稱',connection.name);
  if(name===null)return;
  const model=prompt('預設模型',connection.defaultModel);
  if(model===null)return;
  const apiKey=prompt('新的 API Key（留空表示保留原本金鑰）','');
  const payload={action:'updateConnection',connectionId,name:name.trim(),preset:connection.preset,defaultModel:model.trim(),isActive:connection.isActive};
  if(connection.baseUrl)payload.baseUrl=connection.baseUrl;
  if(apiKey)payload.apiKey=apiKey;
  try{await post('/api/teacher/ai-settings',payload);await renderAiSettings();}
  catch(error){alert('AI Provider 更新失敗：'+(error.message||'請檢查設定與權限。'));}
}
async function toggleAiConnection(connectionId){
  const connection=(state.aiSettings?.connections||[]).find(c=>c.id===connectionId);
  if(!connection)return;
  const payload={
    action:'updateConnection',connectionId,name:connection.name,preset:connection.preset,
    defaultModel:connection.defaultModel,isActive:!connection.isActive
  };
  if(connection.baseUrl)payload.baseUrl=connection.baseUrl;
  try{await post('/api/teacher/ai-settings',payload);await renderAiSettings();}
  catch(error){alert('AI Provider 狀態更新失敗：'+(error.message||'請檢查權限。'));}
}
const AI_TEST_ERROR_LABELS={
  authentication_failed:'認證失敗，請檢查 API Key。',
  invalid_request:'Provider 拒絕請求；請檢查模型名稱或請求參數。',
  insufficient_balance:'API 帳戶餘額不足。',
  model_not_found:'模型不存在或模型名稱已失效。',
  rate_limited:'Provider 目前達到速率限制。',
  endpoint_unreachable:'Provider 目前無法連線。',
  timeout:'連線逾時。',
  invalid_response:'Provider 回傳內容無法解析。'
};
async function testAiConnection(connectionId){
  try{
    const data=await post('/api/teacher/ai-settings',{action:'testConnection',connectionId});
    alert(data.result?.ok?'連線測試成功。':'連線測試失敗。');
  }catch(error){
    const code=error.details?.result?.errorCode||error.message;
    alert('連線測試失敗：'+(AI_TEST_ERROR_LABELS[code]||code));
  }
}
async function deleteAiConnection(connectionId){
  if(!confirm('刪除此 AI Provider 連線？使用此連線的路由也會一併移除。'))return;
  try{await post('/api/teacher/ai-settings',{action:'deleteConnection',connectionId});await renderAiSettings();}
  catch{alert('刪除失敗或權限不足。');}
}
async function saveAiRoute(agentType){
  const card=document.querySelector('[data-agent="'+agentType+'"]');
  const connectionId=card?.querySelector('.ai-route-connection')?.value;
  if(!connectionId)return alert('請先選擇 Provider 連線。');
  const connection=(state.aiSettings?.connections||[]).find(c=>c.id===connectionId);
  const payload={agentType,connectionId,model:connection?.defaultModel||''};
  if(state.user?.role==='admin')payload.action='setSystemRoute';
  else{payload.action='setCaseRoute';payload.caseId=$('aiCaseSelect').value;}
  try{await post('/api/teacher/ai-settings',payload);await renderAiSettings();}
  catch(error){alert('路由儲存失敗：'+(error.message||'請確認病例與 Provider 權限。'));}
}
async function deleteAiRoute(routeId){
  try{await post('/api/teacher/ai-settings',{action:'deleteRoute',routeId});await renderAiSettings();}
  catch{alert('路由移除失敗或權限不足。');}
}

async function renderUsers(){
  if(!state.serverMode||!['teacher','admin'].includes(state.user?.role))return;
  try{
    const r=await fetch('/api/teacher/users');
    if(!r.ok)throw new Error('users');
    const d=await r.json();
    const roleLabels={admin:'管理員',teacher:'教師',student:'學生'};
    const statusLabels={active:'啟用',pending:'待審核',suspended:'停權'};
    $('newUserRole').innerHTML=(d.creatableRoles||[]).map(role=>'<option value="'+role+'">'+roleLabels[role]+'</option>').join('');
    const admin=state.user?.role==='admin';
    $('assignmentPanel').classList.toggle('hidden',!admin);
    if(admin){
      const teachers=(d.users||[]).filter(u=>u.role==='teacher'&&u.accountStatus==='active');
      const students=(d.users||[]).filter(u=>u.role==='student'&&['active','pending'].includes(u.accountStatus));
      $('assignmentTeacher').innerHTML=teachers.map(u=>'<option value="'+u.id+'">'+esc(u.displayName)+' · '+esc(u.email)+'</option>').join('');
      $('assignmentStudent').innerHTML=students.map(u=>'<option value="'+u.id+'">'+esc(u.displayName)+' · '+esc(u.email)+(u.accountStatus==='pending'?'（待審核）':'')+'</option>').join('');
      $('assignmentSummary').textContent=(d.assignments||[]).length+' 組有效指派';
    }
    const sorted=[...(d.users||[])].sort((a,b)=>(a.accountStatus==='pending'?0:1)-(b.accountStatus==='pending'?0:1));
    $('userList').innerHTML=sorted.map(u=>{
      const self=u.id===state.user?.id;
      let actions='';
      if(!self && u.accountStatus==='pending'){
        actions='<button class="small-btn approve-btn" data-user-action="approve" data-user-id="'+u.id+'">核准</button><button class="small-btn danger-btn" data-user-action="reject" data-user-id="'+u.id+'">拒絕</button>';
      }else if(!self && u.accountStatus==='active'){
        actions='<button class="small-btn" data-user-action="suspend" data-user-id="'+u.id+'">停權</button>'+(u.role==='student'||state.user?.role==='admin'?'<button class="small-btn" data-user-action="resetPassword" data-user-id="'+u.id+'">重設密碼</button>':'');
      }else if(!self && u.accountStatus==='suspended'){
        actions='<button class="small-btn" data-user-action="activate" data-user-id="'+u.id+'">啟用</button>'+(u.role==='student'||state.user?.role==='admin'?'<button class="small-btn" data-user-action="resetPassword" data-user-id="'+u.id+'">重設密碼</button>':'');
      }
      return '<div class="manage-row '+(u.accountStatus==='pending'?'pending-row':'')+'"><div><strong>'+esc(u.displayName)+'</strong><small>'+esc(u.email)+' · '+roleLabels[u.role]+' · '+new Date(u.createdAt).toLocaleString('zh-TW')+'</small></div><div class="row-actions"><span class="readonly-pill status-'+esc(u.accountStatus)+'">'+(statusLabels[u.accountStatus]||u.accountStatus)+'</span>'+actions+'</div></div>';
    }).join('')||'<p class="empty">尚無帳號。</p>';
    $('userList').querySelectorAll('[data-user-action]').forEach(b=>b.onclick=()=>manageUser(b.dataset.userId,b.dataset.userAction));
  }catch{$('userList').innerHTML='<p class="empty">帳號清單讀取失敗。</p>';}
}
async function assignStudentToTeacher(){
  const teacherUserId=$('assignmentTeacher').value,studentUserId=$('assignmentStudent').value;
  if(!teacherUserId||!studentUserId)return alert('請先選擇教師與學生。');
  try{
    await post('/api/teacher/users',{action:'assignStudent',teacherUserId,studentUserId});
    await renderUsers();
    alert('教師／學生指派完成。');
  }catch{alert('指派失敗。');}
}
async function createManagedUser(event){
  event.preventDefault();
  try{
    await post('/api/teacher/users',{
      displayName:$('newUserName').value.trim(),
      email:$('newUserEmail').value.trim(),
      password:$('newUserPassword').value,
      role:$('newUserRole').value
    });
    $('userForm').reset();
    await renderUsers();
    alert('帳號已建立。');
  }catch{alert('帳號建立失敗；請確認 Email 未重複、角色權限正確，且密碼至少 12 個字元。');}
}
async function manageUser(userId,action){
  const payload={action,userId};
  if(action==='resetPassword'){
    const p=prompt('輸入新的暫時密碼（至少 12 個字元）');
    if(!p)return;
    payload.newPassword=p;
  }else{
    const prompts={
      suspend:'確定停權此帳號？既有登入會立即失效。',
      activate:'確定重新啟用此帳號？',
      approve:'確定核准這個學生帳號？核准後即可登入。',
      reject:'確定拒絕這個申請？尚未啟用的 pending 帳號會被刪除，學生之後可重新申請。'
    };
    if(!confirm(prompts[action]||'確定執行此操作？'))return;
  }
  try{await post('/api/teacher/users',payload);await renderUsers();}
  catch{alert('帳號操作失敗或權限不足。');}
}
function microusdToUsd(value){return '$'+(Number(value||0)/1000000).toFixed(6);}
function quotaUsdToMicrousd(value){
  const text=String(value??'').trim();
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)&&n>=0?Math.round(n*1000000):null;
}
function quotaNumber(value){
  const text=String(value??'').trim();
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)&&n>=0?Math.round(n):null;
}
function canEditUsageQuota(user){
  if(!user)return false;
  if(state.user?.role==='admin')return true;
  return state.user?.role==='teacher'&&user.role==='student'&&user.id!==state.user?.id;
}
function usageRows(title,rows,labelKey){
  return '<section class="usage-breakdown-group"><h4>'+title+'</h4>'+
    ((rows||[]).length?(rows||[]).map(row=>'<div class="usage-breakdown-row"><strong>'+esc(row[labelKey]||'--')+'</strong><span>'+Number(row.calls||0)+' 次</span><span>'+Number(row.tokens||0).toLocaleString('zh-TW')+' tk</span><span>'+microusdToUsd(row.estimatedCostMicrousd)+'</span></div>').join(''):'<p class="empty">尚無資料。</p>')+
    '</section>';
}
async function renderUsageDashboard(){
  if(!state.serverMode||!['teacher','admin'].includes(state.user?.role))return;
  try{
    const selected=$('usageUserSelect').value||'';
    const params=new URLSearchParams({action:'summary'});
    if(selected)params.set('userId',selected);
    const response=await fetch('/api/teacher/llm-usage?'+params.toString());
    if(!response.ok)throw new Error('usage');
    const data=await response.json();
    state.usageDashboard=data;

    const current=$('usageUserSelect').value;
    $('usageUserSelect').innerHTML='<option value="">全部可見使用者</option>'+
      (data.users||[]).map(u=>'<option value="'+esc(u.id)+'">'+esc(u.displayName||u.email)+' · '+esc(u.role)+'</option>').join('');
    $('usageUserSelect').value=(data.users||[]).some(u=>u.id===current)?current:'';

    const totals=(data.totals||[]).reduce((a,row)=>({
      calls:a.calls+Number(row.calls||0),
      tokens:a.tokens+Number(row.tokens||0),
      cost:a.cost+Number(row.estimatedCostMicrousd||0),
      unpriced:a.unpriced+Number(row.unpricedCalls||0),
      partial:a.partial+Number(row.partialPricingCalls||0)
    }),{calls:0,tokens:0,cost:0,unpriced:0,partial:0});
    $('usageCalls').textContent=totals.calls.toLocaleString('zh-TW');
    $('usageTokens').textContent=totals.tokens.toLocaleString('zh-TW');
    $('usageCost').textContent=microusdToUsd(totals.cost);
    $('usageUnpriced').textContent=totals.unpriced.toLocaleString('zh-TW');
    $('usagePartial').textContent=totals.partial.toLocaleString('zh-TW');
    $('usageBreakdown').innerHTML=
      usageRows('日期',data.byDate,'date')+
      usageRows('Provider',data.byProvider,'preset')+
      usageRows('Model',data.byModel,'model')+
      usageRows('Agent',data.byAgent,'agentType');

    await renderSelectedQuota();
  }catch{
    $('usageBreakdown').innerHTML='<p class="empty">用量資料讀取失敗。</p>';
  }
}
async function renderSelectedQuota(){
  const userId=$('usageUserSelect').value;
  const user=(state.usageDashboard?.users||[]).find(u=>u.id===userId);
  const editable=canEditUsageQuota(user);
  $('quotaForm').classList.toggle('disabled',!editable);
  $('quotaSaveBtn').disabled=!editable;
  if(!userId){
    $('quotaHelp').textContent='選擇一位使用者查看配額。';
    ['quotaDailyTokens','quotaMonthlyTokens','quotaDailyCost','quotaMonthlyCost'].forEach(id=>$(id).value='');
    $('quotaEnabled').checked=true;
    return;
  }
  try{
    const response=await fetch('/api/teacher/llm-usage?action=quota&userId='+encodeURIComponent(userId));
    if(!response.ok)throw new Error('quota');
    const quota=(await response.json()).quota;
    $('quotaDailyTokens').value=quota?.dailyTokenLimit??'';
    $('quotaMonthlyTokens').value=quota?.monthlyTokenLimit??'';
    $('quotaDailyCost').value=quota?.dailyCostLimitMicrousd==null?'':Number(quota.dailyCostLimitMicrousd)/1000000;
    $('quotaMonthlyCost').value=quota?.monthlyCostLimitMicrousd==null?'':Number(quota.monthlyCostLimitMicrousd)/1000000;
    $('quotaEnabled').checked=quota?.isActive!==false;
    $('quotaHelp').textContent=editable?'可設定硬上限；留空代表該維度不限。':'此帳號僅供查看，你沒有修改其配額的權限。';
  }catch{$('quotaHelp').textContent='配額讀取失敗。';}
}
async function saveUsageQuota(event){
  event.preventDefault();
  const userId=$('usageUserSelect').value;
  const user=(state.usageDashboard?.users||[]).find(u=>u.id===userId);
  if(!canEditUsageQuota(user))return;
  const payload={
    action:'setQuota',userId,
    dailyTokenLimit:quotaNumber($('quotaDailyTokens').value),
    monthlyTokenLimit:quotaNumber($('quotaMonthlyTokens').value),
    dailyCostLimitMicrousd:quotaUsdToMicrousd($('quotaDailyCost').value),
    monthlyCostLimitMicrousd:quotaUsdToMicrousd($('quotaMonthlyCost').value),
    isActive:$('quotaEnabled').checked
  };
  try{
    await post('/api/teacher/llm-usage',payload);
    await renderSelectedQuota();
    alert('配額已儲存。');
  }catch(error){alert('配額儲存失敗：'+(error.message||'請確認權限與數值。'));}
}
async function renderSecurityAudit(){
  if(!state.serverMode||state.user?.role!=='admin')return;
  try{
    const d=await fetch('/api/auth/audit?limit=100').then(r=>r.json());
    $('auditList').innerHTML=(d.events||[]).map(e=>'<div class="audit-event '+(e.success?'ok':'fail')+'"><div><strong>'+esc(e.action)+'</strong><small>'+esc(e.reason||'')+' · '+new Date(e.createdAt).toLocaleString('zh-TW')+'</small></div><span>'+esc(e.identifier||'')+'</span></div>').join('')||'<p class="empty">尚無稽核事件。</p>';
  }catch{$('auditList').innerHTML='<p class="empty">稽核紀錄讀取失敗。</p>';}
}
async function changeOwnPassword(event){
  event.preventDefault();
  try{
    await post('/api/auth/change-password',{currentPassword:$('currentPassword').value,newPassword:$('nextPassword').value});
    alert('密碼已變更，所有既有登入已失效，請重新登入。');location.reload();
  }catch{$('passwordError').textContent='變更失敗；請確認目前密碼與新密碼（至少 12 個字元）。';}
}
async function loadTeacherCases(){if(state.serverMode&&!['teacher','admin'].includes(state.user?.role))return;if(state.teacherCases.length)return;try{const r=await fetch('/api/teacher/cases');const d=await r.json();state.teacherCases=[...(d.cases||[]).map(c=>({...c,source:'builtin'})),...state.customCases.map(c=>({...c,internalTitle:c.title,source:'custom'}))];renderCases();}catch{state.teacherCases=state.customCases.map(c=>({...c,internalTitle:c.title,source:'custom'}));renderCases();}}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');if(b.dataset.tab==='teacher')loadTeacherCases();});
document.querySelectorAll('.teacher-subtab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.teacher-subtab,.teacher-view').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  const map={cases:'teacherCases',records:'teacherRecords',users:'teacherUsers',ai:'teacherAiSettings',usage:'teacherUsage',audit:'teacherAudit'};
  $(map[b.dataset.view]).classList.add('active');
  if(b.dataset.view==='records')renderRecords();
  if(b.dataset.view==='users')renderUsers();
  if(b.dataset.view==='ai')renderAiSettings();
  if(b.dataset.view==='usage')renderUsageDashboard();
  if(b.dataset.view==='audit')renderSecurityAudit();
});

function addBuilderFactRow(){
  const row=document.createElement('div');row.className='fact-editor-row';
  row.innerHTML='<label>項目名稱<input class="bf-label" placeholder="例如：喝水嗆咳"></label><label>病人答案<textarea class="bf-value" rows="2" placeholder="學生問到後才可透露的內容"></textarea></label><div class="form-grid compact"><label>觸發關鍵字<input class="bf-triggers" placeholder="喝水、嗆、液體"></label><label>配分<input class="bf-points" type="number" min="0" max="100" value="10"></label></div><button type="button" class="link-danger">移除此項</button>';
  row.querySelector('.link-danger').onclick=()=>row.remove();$('builderFacts').append(row);
}
function openBuilder(){$('caseBuilder').classList.remove('hidden');$('builderFacts').innerHTML='';addBuilderFactRow();$('caseBuilder').scrollIntoView({behavior:'smooth'});}
async function saveBuilder(e){e.preventDefault();const facts=[...$('builderFacts').querySelectorAll('.fact-editor-row')].map((r,i)=>({id:'fact_'+Date.now()+'_'+i,label:r.querySelector('.bf-label').value.trim(),category:'teacher_defined',value:r.querySelector('.bf-value').value.trim(),triggers:r.querySelector('.bf-triggers').value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),mayVolunteer:false,points:Number(r.querySelector('.bf-points').value)||0})).filter(f=>f.label&&f.value&&f.triggers.length);if(!facts.length)return alert('至少需要一個完整病例資訊項目。');const id='case_'+Date.now();const c={id,title:$('builderTitle').value.trim(),studentLabel:$('builderStudentLabel').value.trim()||'自訂臨床問診案例',difficulty:$('builderDifficulty').value.trim()||'自訂',studentBrief:$('builderBrief').value.trim(),learningGoals:$('builderGoals').value.split(/\n/).map(x=>x.trim()).filter(Boolean),patient:{name:$('builderPatient').value.trim(),age:Number($('builderAge').value)||0,gender:'',persona:$('builderPersona').value.trim()},opening:$('builderOpening').value.trim(),facts:facts.map(({points,...f})=>f),rubric:facts.filter(f=>f.points>0).map(f=>({id:'rubric_'+f.id,label:f.label,factIds:[f.id],points:f.points})),source:'custom'};if(!c.title||!c.patient.name||!c.opening)return alert('請填寫病例名稱、病人姓名與開場白。');if(state.serverMode){
  try{
    await post('/api/teacher/cases',{definition:c,status:'published'});
    state.teacherCases=[];await loadTeacherCases();
    const student=await fetch('/api/cases').then(r=>r.json());
    state.cases=student.cases.map(x=>({...x,source:'builtin'}));
    $('caseSelect').innerHTML=state.cases.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.studentLabel||'臨床問診案例')+'</option>').join('');
  }catch{return alert('病例儲存到伺服器失敗。');}
}else{
  state.customCases.push(c);write(CKEY,state.customCases);state.cases.push(c);state.teacherCases.push({...c,internalTitle:c.title});
  $('caseSelect').innerHTML=state.cases.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.studentLabel||'臨床問診案例')+(x.source==='custom'?'（教師建立）':'')+'</option>').join('');
  renderCases();
}
$('caseBuilder').classList.add('hidden');$('caseBuilderForm').reset();alert('病例已建立，可立即切回學生端選用。');}
document.querySelectorAll('[data-demo-role]').forEach(button=>button.onclick=()=>demoLogin(button.dataset.demoRole));$('loginForm').onsubmit=login;$('registerForm').onsubmit=registerAccount;$('showRegisterBtn').onclick=()=>showRegister('student');$('showTeacherRegisterBtn').onclick=()=>showRegister('teacher');$('backToLoginBtn').onclick=()=>showLogin();$('bootstrapForm').onsubmit=bootstrap;$('assignStudentBtn').onclick=assignStudentToTeacher;$('logoutBtn').onclick=logout;$('changePasswordBtn').onclick=()=>$('passwordDialog').showModal();$('changePasswordForm').onsubmit=changeOwnPassword;$('cancelPasswordBtn').onclick=()=>$('passwordDialog').close();$('userForm').onsubmit=createManagedUser;$('quotaForm').onsubmit=saveUsageQuota;$('usageUserSelect').onchange=renderUsageDashboard;$('aiConnectionForm').onsubmit=createAiConnection;$('aiPreset').onchange=syncAiPresetFields;$('aiCaseSelect').onchange=renderAiSettings;$('newCaseBtn').onclick=openBuilder;$('addBuilderFactBtn').onclick=addBuilderFactRow;$('cancelBuilderBtn').onclick=()=>$('caseBuilder').classList.add('hidden');$('caseBuilderForm').onsubmit=saveBuilder;
init();
