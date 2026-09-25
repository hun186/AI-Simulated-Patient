const SKEY='aisp-formal-session-v1',RKEY='aisp-formal-records-v1',CKEY='aisp-formal-custom-cases-v1';
const state={serverMode:false,user:null,cases:[],teacherCases:[],caseId:'aphasia_001',caseData:null,mode:'training',studentName:'',transcript:[],revealedFactIds:[],sessionId:null,records:[],coach:null,coachEnabled:false,coachUsed:false,customCases:[]};
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
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok)throw new Error(url);
  if(r.status===204)return {};
  const text=await r.text();
  return text?JSON.parse(text):{};
}
async function ask(q){state.transcript.push({role:'student',content:q,at:new Date().toISOString()});renderChat();$('sendBtn').disabled=true;try{const d=await post('/api/chat',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,message:q,revealedFactIds:state.serverMode?[]:state.revealedFactIds});if(!state.serverMode)state.revealedFactIds=d.revealedFactIds;state.transcript.push({role:'patient',content:d.reply,at:new Date().toISOString()});if(state.mode==='training'&&state.coachEnabled){state.coach=await post('/api/coach',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,transcript:state.transcript,revealedFactIds:state.serverMode?[]:state.revealedFactIds});state.coachUsed=true;}save();renderChat();renderMode();renderCoach();}catch{state.transcript.push({role:'patient',content:'（系統暫時無法取得回覆。）'});renderChat();}finally{$('sendBtn').disabled=false;}}
function renderEvaluation(d){$('resultCard').classList.remove('hidden');$('scoreCircle').textContent=String(d.percentage);$('resultMode').textContent=modeLabel(d.mode)+' · '+d.totalScore+'/'+d.maxScore+' 分';$('overallComment').textContent=d.overall.comment;$('strengthList').innerHTML=d.overall.strengths.map(x=>'<li>'+esc(x)+'</li>').join('');$('improvementList').innerHTML=d.overall.improvements.map(x=>'<li>'+esc(x)+'</li>').join('');$('recommendationList').innerHTML=d.overall.recommendations.map(x=>'<li>'+esc(x)+'</li>').join('');$('nextPracticeFocus').textContent=d.overall.nextPracticeFocus;$('rubricTable').innerHTML=d.items.map(i=>'<div class="rubric-item"><div class="rubric-main"><strong>'+esc(i.criterion)+'</strong><span>'+i.score+'/'+i.maxScore+'</span><span class="status status-'+i.status+'">'+(i.status==='covered'?'完整涵蓋':i.status==='partial'?'部分涵蓋':'未涵蓋')+'</span></div><div class="rubric-detail"><span>'+esc(i.reasoning)+'</span>'+(i.evidence?.[0]?'<span class="evidence-quote">證據：「'+esc(i.evidence[0].quote)+'」</span>':'')+'</div></div>').join('');}
async function finish(){try{const d=await post('/api/evaluate',{caseId:state.caseId,caseDefinition:state.serverMode?null:currentCaseDefinition(),sessionId:state.serverMode?state.sessionId:null,transcript:state.transcript,revealedFactIds:state.revealedFactIds,mode:state.mode});renderEvaluation(d);if(state.serverMode){if(state.user?.role==='teacher')await renderRecords();return;}const rec={id:state.sessionId,studentName:state.studentName||'未填姓名',caseTitle:state.caseData.studentLabel||state.caseData.title||'臨床問診案例',mode:state.mode,coachUsed:state.mode==='training'&&state.coachUsed,completedAt:new Date().toISOString(),transcript:state.transcript,evaluation:d};state.records=read(RKEY,[]);const ix=state.records.findIndex(x=>x.id===rec.id);if(ix>=0)state.records[ix]=rec;else state.records.unshift(rec);write(RKEY,state.records);renderRecords();}catch{alert('評量失敗');}}
function renderCases(){const list=state.teacherCases.length?state.teacherCases:state.customCases;$('teacherCaseList').innerHTML=list.length?list.map(c=>'<div class="manage-row"><div><strong>'+esc(c.internalTitle||c.title||'未命名病例')+'</strong><small>學生看到：'+esc(c.studentLabel||'臨床問診案例')+' · '+esc(c.patient?.name||'')+' · '+esc(c.difficulty||'')+' · '+(c.learningGoals||[]).length+' 個學習目標</small></div><span class="readonly-pill">'+(c.source==='custom'?'教師建立':'系統內建')+'</span></div>').join(''):'<p class="empty">尚無病例。</p>';}
async function renderRecords(){if(state.serverMode){if(state.user?.role!=='teacher')return;try{
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
  document.querySelector('[data-tab="teacher"]').classList.toggle('hidden',state.serverMode&&state.user?.role!=='teacher');document.querySelector('[data-view="users"]').classList.toggle('hidden',!state.serverMode||state.user?.role!=='teacher');$('studentName').disabled=state.serverMode;
  $('runtimeStatus').textContent=state.serverMode?'Server DB · '+(state.user?.displayName||''):'Demo · Browser local';$('logoutBtn').classList.toggle('hidden',!state.serverMode);
  if(state.user?.displayName) state.studentName=state.user.displayName;
  renderRecords();await start();
}
function showLogin(message=''){
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  $('loginForm').classList.remove('hidden');$('bootstrapForm').classList.add('hidden');
  $('loginError').textContent=message;
}
function showBootstrap(message=''){
  $('authGate').classList.remove('hidden');$('appRoot').classList.add('hidden');
  $('loginForm').classList.add('hidden');$('bootstrapForm').classList.remove('hidden');
  $('bootstrapError').textContent=message;
}
async function init(){
  try{
    const runtime=await fetch('/api/runtime').then(r=>r.json());
    state.serverMode=runtime.persistence==='postgres';
    if(state.serverMode){
      if(runtime.needsBootstrap){showBootstrap();return;}
      const me=await fetch('/api/auth/me');
      if(!me.ok){showLogin();return;}
      state.user=(await me.json()).user;
    }
    $('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');
    await loadApplication();
  }catch(error){console.error(error);showLogin('系統初始化失敗，請檢查伺服器與資料庫設定。');}
}
async function login(event){
  event.preventDefault();
  try{
    const d=await post('/api/auth/login',{email:$('loginEmail').value.trim(),password:$('loginPassword').value});
    state.user=d.user;$('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');await loadApplication();
  }catch{$('loginError').textContent='登入失敗，請檢查帳號密碼。';}
}
async function bootstrap(event){
  event.preventDefault();
  try{
    const d=await post('/api/auth/bootstrap',{
      setupKey:$('bootstrapKey').value,
      email:$('bootstrapEmail').value.trim(),
      password:$('bootstrapPassword').value,
      displayName:$('bootstrapName').value.trim()
    });
    state.user=d.user;
    $('authGate').classList.add('hidden');$('appRoot').classList.remove('hidden');
    await loadApplication();
  }catch{$('bootstrapError').textContent='建立失敗；請確認 schema 已套用、Setup Key 正確，且密碼至少 10 個字元。';}
}
async function logout(){await post('/api/auth/logout',{});location.reload();}
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
async function renderUsers(){
  if(!state.serverMode||state.user?.role!=='teacher')return;
  try{
    const r=await fetch('/api/teacher/users');
    if(!r.ok)throw new Error('users');
    const d=await r.json();
    $('userList').innerHTML=(d.users||[]).map(u=>'<div class="manage-row"><div><strong>'+esc(u.displayName)+'</strong><small>'+esc(u.email)+' · '+(u.role==='teacher'?'教師':'學生')+'</small></div><span class="readonly-pill">'+(u.isActive?'啟用':'停用')+'</span></div>').join('')||'<p class="empty">尚無帳號。</p>';
  }catch{$('userList').innerHTML='<p class="empty">帳號清單讀取失敗。</p>';}
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
  }catch{alert('帳號建立失敗；請確認 Email 未重複，且密碼至少 10 個字元。');}
}
async function loadTeacherCases(){if(state.serverMode&&state.user?.role!=='teacher')return;if(state.teacherCases.length)return;try{const r=await fetch('/api/teacher/cases');const d=await r.json();state.teacherCases=[...(d.cases||[]).map(c=>({...c,source:'builtin'})),...state.customCases.map(c=>({...c,internalTitle:c.title,source:'custom'}))];renderCases();}catch{state.teacherCases=state.customCases.map(c=>({...c,internalTitle:c.title,source:'custom'}));renderCases();}}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');if(b.dataset.tab==='teacher')loadTeacherCases();});
document.querySelectorAll('.teacher-subtab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.teacher-subtab,.teacher-view').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  const map={cases:'teacherCases',records:'teacherRecords',users:'teacherUsers'};
  $(map[b.dataset.view]).classList.add('active');
  if(b.dataset.view==='records')renderRecords();
  if(b.dataset.view==='users')renderUsers();
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
$('loginForm').onsubmit=login;$('bootstrapForm').onsubmit=bootstrap;$('logoutBtn').onclick=logout;$('userForm').onsubmit=createManagedUser;$('newCaseBtn').onclick=openBuilder;$('addBuilderFactBtn').onclick=addBuilderFactRow;$('cancelBuilderBtn').onclick=()=>$('caseBuilder').classList.add('hidden');$('caseBuilderForm').onsubmit=saveBuilder;
init();