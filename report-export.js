const AGENT_LABELS={patient:'Patient',coach:'Coach',evaluator:'Evaluator'};
const PROVIDER_LABELS={
  openai:'OpenAI',deepseek:'DeepSeek',ollama_cloud:'Ollama Cloud',
  ollama:'Ollama Local',dify:'Dify',custom:'Custom',mock:'Rule-based / Mock'
};

function esc(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function xml(value){
  return String(value??'').replace(/[&<>"]/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[ch]));
}
function dateText(value){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value);
  return new Intl.DateTimeFormat('zh-TW',{
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).format(d);
}
function durationText(start,end){
  const a=new Date(start).getTime(),b=new Date(end).getTime();
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)return '—';
  const total=Math.round((b-a)/60000);
  const h=Math.floor(total/60),m=total%60;
  return h?h+' 小時 '+m+' 分鐘':m+' 分鐘';
}
function modeText(mode){return mode==='exam'?'考試評量':'訓練學習';}
function statusText(status){
  return status==='covered'?'完整涵蓋':status==='partial'?'部分涵蓋':status==='missed'?'未涵蓋':String(status||'—');
}
function providerText(route){
  if(!route)return '未設定';
  const preset=String(route.preset||route.providerKind||'').toLowerCase();
  return (PROVIDER_LABELS[preset]||route.preset||route.providerKind||'Provider')+
    ' · '+String(route.model||'未指定模型');
}
function moneyMicro(value,currency){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return null;
  return new Intl.NumberFormat('zh-TW',{
    style:'currency',currency,maximumFractionDigits:currency==='TWD'?2:6
  }).format(n/1_000_000);
}
function cleanFilePart(value){
  return String(value||'report')
    .replace(/[\\/:*?"<>|]+/g,'_')
    .replace(/\s+/g,'_')
    .slice(0,80)||'report';
}
function teacherText(model){
  if(!model.teachers.length)return '未記錄';
  const names=model.teachers.map(t=>t.displayName||t.name||t.id).filter(Boolean).join('、');
  return model.teacherSource==='current_assignment'
    ?names+'（目前指派；非歷史快照）'
    :names;
}

export function buildReportModel(record){
  const evaluation=record?.evaluation||{};
  const routes=record?.llmRoutes||{};
  const usage=Array.isArray(record?.llmUsage)?record.llmUsage:[];
  const usageByAgent={};
  for(const agent of ['patient','coach','evaluator']){
    const rows=usage.filter(item=>item.agentType===agent);
    const successful=rows.filter(item=>item.success);
    const totalTokens=rows.reduce((sum,item)=>sum+Number(item.totalTokens||0),0);
    const twd=rows.reduce((sum,item)=>sum+Number(item.estimatedCostMicrontd||0),0);
    const usd=rows.reduce((sum,item)=>sum+Number(item.estimatedCostMicrousd||0),0);
    usageByAgent[agent]={
      calls:rows.length,successful:successful.length,totalTokens,
      costTwd:moneyMicro(twd,'TWD'),costUsd:moneyMicro(usd,'USD'),
      errors:rows.filter(item=>!item.success).length
    };
  }
  return {
    id:String(record?.id||''),
    caseTitle:String(record?.caseTitle||'臨床問診案例'),
    studentName:String(record?.studentName||'未記錄'),
    studentUserId:String(record?.studentUserId||''),
    teachers:Array.isArray(record?.teachers)?record.teachers:[],
    teacherSource:String(record?.teacherSource||'none'),
    mode:String(record?.mode||'training'),
    modeLabel:modeText(record?.mode),
    coachEnabled:Boolean(record?.coachEnabled),
    coachUsed:Boolean(record?.coachUsed),
    startedAt:record?.startedAt||record?.completedAt||null,
    endedAt:record?.endedAt||record?.completedAt||null,
    duration:durationText(record?.startedAt||record?.completedAt,record?.endedAt||record?.completedAt),
    transcript:Array.isArray(record?.transcript)?record.transcript:[],
    coachEvents:Array.isArray(record?.coachEvents)?record.coachEvents:[],
    routes,
    usageByAgent,
    usage,
    evaluation:{
      totalScore:Number(evaluation.totalScore??record?.totalScore??0),
      maxScore:Number(evaluation.maxScore??record?.maxScore??0),
      percentage:Number(evaluation.percentage??record?.percentage??0),
      items:Array.isArray(evaluation.items)?evaluation.items:[],
      overall:evaluation.overall||{
        comment:'',strengths:[],improvements:[],recommendations:[],nextPracticeFocus:''
      }
    }
  };
}

function llmRows(model){
  return ['patient','coach','evaluator'].map(agent=>{
    const route=model.routes?.[agent]||null;
    const usage=model.usageByAgent[agent];
    const cost=usage.costTwd||usage.costUsd||'—';
    return {
      agent:AGENT_LABELS[agent],
      provider:providerText(route),
      calls:usage.calls,
      tokens:usage.totalTokens,
      cost,
      note:usage.errors?('失敗 '+usage.errors+' 次'):''
    };
  });
}

function reportBodyHtml(model){
  const overall=model.evaluation.overall||{};
  const transcript=model.transcript.map((m,index)=>{
    const speaker=m.role==='student'?'做答人':m.role==='patient'?'模擬病人':m.role==='system'?'系統':String(m.role||'—');
    return '<tr><td>'+(index+1)+'</td><td>'+esc(dateText(m.at))+'</td><td>'+esc(speaker)+'</td><td>'+esc(m.content)+'</td></tr>';
  }).join('')||'<tr><td colspan="4">無問答紀錄</td></tr>';

  const coach=model.coachEvents.map((event,index)=>{
    const q=event.lastQuestion?.text||'—';
    const quality=event.lastQuestion?.comment||event.lastQuestion?.level||'—';
    return '<article class="coach-event"><div class="event-title">AI Coach #'+(index+1)+' · '+esc(dateText(event.at))+'</div>'+
      '<div><b>學生問句：</b>'+esc(q)+'</div>'+
      '<div><b>問句品質：</b>'+esc(quality)+'</div>'+
      '<div><b>下一步提示：</b>'+esc(event.nextHint||'—')+'</div>'+
      '<div><b>反思提示：</b>'+esc(event.reflectionPrompt||'—')+'</div></article>';
  }).join('')||'<p class="muted">'+(model.coachUsed?'本紀錄建立時未保存逐輪 Coach 內容。':'本場未使用 AI Coach。')+'</p>';

  const llm=llmRows(model).map(row=>
    '<tr><td>'+esc(row.agent)+'</td><td>'+esc(row.provider)+'</td><td>'+row.calls+'</td><td>'+row.tokens.toLocaleString('zh-TW')+'</td><td>'+esc(row.cost)+'</td><td>'+esc(row.note||'—')+'</td></tr>'
  ).join('');

  const list=(items)=>Array.isArray(items)&&items.length
    ?'<ul>'+items.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>'
    :'<p class="muted">—</p>';

  const rubric=model.evaluation.items.map((item,index)=>{
    const evidence=(item.evidence||[]).map(e=>'第 '+esc(e.turn)+' 輪：「'+esc(e.quote)+'」').join('<br>')||'—';
    return '<tr><td>'+(index+1)+'</td><td>'+esc(item.criterion||item.id||'')+'</td><td>'+esc(statusText(item.status))+'</td><td>'+esc(item.score)+' / '+esc(item.maxScore)+'</td><td>'+esc(item.reasoning||'—')+'</td><td>'+evidence+'</td></tr>';
  }).join('')||'<tr><td colspan="6">無評量明細</td></tr>';

  return `
  <header class="report-header">
    <div class="brand">AI Simulated Patient</div>
    <h1>問診學習與評量報告</h1>
    <p>${esc(model.caseTitle)}</p>
  </header>

  <section>
    <h2>一、基本資訊</h2>
    <div class="meta-grid">
      <div><span>做答人</span><strong>${esc(model.studentName)}</strong></div>
      <div><span>教師</span><strong>${esc(teacherText(model))}</strong></div>
      <div><span>模式</span><strong>${esc(model.modeLabel)}</strong></div>
      <div><span>AI Coach</span><strong>${model.coachUsed?'曾使用':model.coachEnabled?'已啟用、未使用':'未使用'}</strong></div>
      <div><span>開始時間</span><strong>${esc(dateText(model.startedAt))}</strong></div>
      <div><span>結束時間</span><strong>${esc(dateText(model.endedAt))}</strong></div>
      <div><span>作答時間</span><strong>${esc(model.duration)}</strong></div>
      <div><span>Session ID</span><strong class="mono">${esc(model.id||'—')}</strong></div>
    </div>
  </section>

  <section>
    <h2>二、AI / LLM 執行資訊</h2>
    <table><thead><tr><th>Agent</th><th>Provider / Model</th><th>呼叫次數</th><th>Tokens</th><th>估計成本</th><th>備註</th></tr></thead>
    <tbody>${llm}</tbody></table>
    <p class="footnote">Provider / Model 以本場 session 的 route snapshot 為準；呼叫次數、tokens 與成本來自實際 LLM usage events。未定價的 Provider 不推估成本。</p>
  </section>

  <section>
    <h2>三、完整問答紀錄</h2>
    <table class="transcript"><thead><tr><th>#</th><th>時間</th><th>角色</th><th>內容</th></tr></thead><tbody>${transcript}</tbody></table>
  </section>

  <section>
    <h2>四、AI Coach 訓練紀錄</h2>
    ${coach}
  </section>

  <section>
    <h2>五、結束評量</h2>
    <div class="score-card"><strong>${esc(model.evaluation.percentage)}%</strong><span>${esc(model.evaluation.totalScore)} / ${esc(model.evaluation.maxScore)} 分</span></div>
    <div class="summary-box"><h3>AI 總評</h3><p>${esc(overall.comment||'—')}</p></div>
    <div class="eval-grid">
      <div><h3>做得好的地方</h3>${list(overall.strengths)}</div>
      <div><h3>優先改善</h3>${list(overall.improvements)}</div>
      <div><h3>下一步建議</h3>${list(overall.recommendations)}</div>
      <div><h3>下一次練習重點</h3><p>${esc(overall.nextPracticeFocus||'—')}</p></div>
    </div>
  </section>

  <section>
    <h2>六、Rubric 評量明細</h2>
    <table><thead><tr><th>#</th><th>評量項目</th><th>狀態</th><th>得分</th><th>判定理由</th><th>問答證據</th></tr></thead><tbody>${rubric}</tbody></table>
  </section>

  <footer>本報告由 AI Simulated Patient 系統依保存的 session、問答、LLM route/usage 與評量結果產生。</footer>`;
}

export function buildReportHtml(record){
  const model=buildReportModel(record);
  const title=cleanFilePart(model.studentName+'_'+model.caseTitle+'_問診評量報告');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page{size:A4;margin:14mm 13mm}*{box-sizing:border-box}body{font-family:"Microsoft JhengHei","Noto Sans TC","PingFang TC",sans-serif;color:#263449;background:#fff;font-size:11pt;line-height:1.6;margin:0}.report{max-width:190mm;margin:0 auto}.report-header{padding:18px 20px;border-radius:16px;background:#eef4fb;border:1px solid #dbe6f3;margin-bottom:20px}.brand{font-size:9pt;letter-spacing:.12em;text-transform:uppercase;color:#607796;font-weight:700}.report-header h1{font-size:24pt;line-height:1.25;margin:5px 0;color:#203b60}.report-header p{margin:0;color:#66758c}section{break-inside:auto;margin:0 0 22px}h2{font-size:15pt;color:#264f7c;border-bottom:2px solid #dce8f5;padding-bottom:5px;margin:0 0 12px}h3{font-size:11pt;color:#39556f;margin:0 0 6px}.meta-grid,.eval-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.meta-grid>div,.eval-grid>div,.summary-box,.coach-event{border:1px solid #e1e7ef;border-radius:10px;padding:9px 11px;background:#fafbfd}.meta-grid span{display:block;font-size:8.5pt;color:#778399}.meta-grid strong{display:block;margin-top:2px}.mono{font-family:ui-monospace,monospace;font-size:8.5pt}table{width:100%;border-collapse:collapse;font-size:9pt;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}th{background:#edf3fa;color:#365473;text-align:left;font-weight:700}th,td{border:1px solid #dfe5ed;padding:6px 7px;vertical-align:top}.transcript th:nth-child(1){width:7%}.transcript th:nth-child(2){width:19%}.transcript th:nth-child(3){width:13%}.score-card{display:inline-flex;align-items:baseline;gap:12px;padding:10px 16px;border-radius:12px;background:#edf7f1;border:1px solid #d0e8d9;margin-bottom:10px}.score-card strong{font-size:25pt;color:#226142}.score-card span{font-weight:700}.summary-box{margin-bottom:10px}.eval-grid{margin-top:8px}.eval-grid ul{margin:0;padding-left:20px}.coach-event{margin-bottom:8px}.event-title{font-weight:800;color:#355778;margin-bottom:4px}.footnote,.muted{font-size:8.5pt;color:#7b8798}.footnote{margin:6px 0 0}footer{margin-top:24px;padding-top:8px;border-top:1px solid #dfe5ed;color:#8792a2;font-size:8pt;text-align:center}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report{max-width:none}}
</style></head><body><main class="report">${reportBodyHtml(model)}</main></body></html>`;
}

function p(text,{style='Normal',bold=false,color='',align='',size=0}={}){
  const lines=String(text??'').split('\n');
  const runs=lines.map((line,index)=>{
    const br=index?'<w:br/>':'';
    const props=[
      bold?'<w:b/>':'',
      color?'<w:color w:val="'+color+'"/>':'',
      size?'<w:sz w:val="'+size+'"/><w:szCs w:val="'+size+'"/>':''
    ].join('');
    return '<w:r><w:rPr>'+props+'</w:rPr>'+br+'<w:t xml:space="preserve">'+xml(line)+'</w:t></w:r>';
  }).join('');
  return '<w:p><w:pPr><w:pStyle w:val="'+style+'"/>'+(align?'<w:jc w:val="'+align+'"/>':'')+'</w:pPr>'+runs+'</w:p>';
}
function tc(text,{header=false,width=0}={}){
  return '<w:tc><w:tcPr>'+(width?'<w:tcW w:w="'+width+'" w:type="dxa"/>':'')+
    (header?'<w:shd w:fill="EAF1F8"/>':'')+'</w:tcPr>'+p(text,{bold:header})+'</w:tc>';
}
function table(rows,{header=true,widths=[]}={}){
  const border='<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D8E0EA"/><w:left w:val="single" w:sz="4" w:color="D8E0EA"/><w:bottom w:val="single" w:sz="4" w:color="D8E0EA"/><w:right w:val="single" w:sz="4" w:color="D8E0EA"/><w:insideH w:val="single" w:sz="4" w:color="D8E0EA"/><w:insideV w:val="single" w:sz="4" w:color="D8E0EA"/></w:tblBorders>';
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'+border+'<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>'+
    rows.map((row,ri)=>'<w:tr>'+row.map((cell,ci)=>tc(cell,{header:header&&ri===0,width:widths[ci]||0})).join('')+'</w:tr>').join('')+
    '</w:tbl>';
}
function bullets(items){
  if(!Array.isArray(items)||!items.length)return p('—');
  return items.map(item=>p('• '+item)).join('');
}
function buildDocumentXml(model){
  const overall=model.evaluation.overall||{};
  const teachers=teacherText(model);
  const infoRows=[
    ['做答人',model.studentName,'教師',teachers],
    ['模式',model.modeLabel,'AI Coach',model.coachUsed?'曾使用':model.coachEnabled?'已啟用、未使用':'未使用'],
    ['開始時間',dateText(model.startedAt),'結束時間',dateText(model.endedAt)],
    ['作答時間',model.duration,'Session ID',model.id||'—']
  ];
  const llm=[['Agent','Provider / Model','呼叫','Tokens','估計成本','備註'],
    ...llmRows(model).map(x=>[x.agent,x.provider,String(x.calls),String(x.tokens),x.cost,x.note||'—'])
  ];
  const transcript=[['#','時間','角色','內容'],
    ...model.transcript.map((m,i)=>[
      String(i+1),dateText(m.at),m.role==='student'?'做答人':m.role==='patient'?'模擬病人':String(m.role||'—'),String(m.content||'')
    ])
  ];
  const coach=[['#','時間','學生問句','問句品質','下一步提示','反思提示'],
    ...model.coachEvents.map((e,i)=>[
      String(i+1),dateText(e.at),String(e.lastQuestion?.text||'—'),
      String(e.lastQuestion?.comment||e.lastQuestion?.level||'—'),
      String(e.nextHint||'—'),String(e.reflectionPrompt||'—')
    ])
  ];
  const rubric=[['#','評量項目','狀態','得分','判定理由','問答證據'],
    ...model.evaluation.items.map((item,i)=>[
      String(i+1),String(item.criterion||item.id||''),statusText(item.status),
      String(item.score)+' / '+String(item.maxScore),String(item.reasoning||'—'),
      (item.evidence||[]).map(e=>'第 '+e.turn+' 輪：「'+e.quote+'」').join('\n')||'—'
    ])
  ];

  const body=[
    p('AI Simulated Patient',{style:'Subtitle',align:'center',color:'607796'}),
    p('問診學習與評量報告',{style:'Title',align:'center'}),
    p(model.caseTitle,{style:'Subtitle',align:'center'}),
    p('一、基本資訊',{style:'Heading1'}),table(infoRows,{header:false,widths:[1500,3300,1500,3300]}),
    p('二、AI / LLM 執行資訊',{style:'Heading1'}),table(llm,{widths:[1200,3000,900,1000,1300,1700]}),
    p('Provider / Model 以本場 session route snapshot 為準；呼叫與 tokens/cost 來自實際 LLM usage events。',{style:'Small'}),
    p('三、完整問答紀錄',{style:'Heading1'}),table(transcript,{widths:[500,1700,1000,6100]}),
    p('四、AI Coach 訓練紀錄',{style:'Heading1'}),
    model.coachEvents.length?table(coach,{widths:[500,1400,1900,1600,2500,2300]}):p(model.coachUsed?'本紀錄建立時未保存逐輪 Coach 內容。':'本場未使用 AI Coach。'),
    p('五、結束評量',{style:'Heading1'}),
    p('總分：'+model.evaluation.totalScore+' / '+model.evaluation.maxScore+'　（'+model.evaluation.percentage+'%）',{style:'Heading2'}),
    p('AI 總評',{style:'Heading2'}),p(overall.comment||'—'),
    p('做得好的地方',{style:'Heading2'}),bullets(overall.strengths),
    p('優先改善',{style:'Heading2'}),bullets(overall.improvements),
    p('下一步建議',{style:'Heading2'}),bullets(overall.recommendations),
    p('下一次練習重點',{style:'Heading2'}),p(overall.nextPracticeFocus||'—'),
    p('六、Rubric 評量明細',{style:'Heading1'}),table(rubric,{widths:[450,1500,1000,900,2800,2650]}),
    p('本報告由 AI Simulated Patient 系統依保存的 session、問答、LLM route/usage 與評量結果產生。',{style:'Small',align:'center'})
  ].join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="794" w:right="737" w:bottom="794" w:left="737" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'+
    '</w:body></w:document>';
}
function stylesXml(){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>'+
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:color w:val="203B60"/><w:sz w:val="38"/></w:rPr><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="607796"/><w:sz w:val="20"/></w:rPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:color w:val="264F7C"/><w:sz w:val="28"/></w:rPr><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:color w:val="39556F"/><w:sz w:val="23"/></w:rPr><w:pPr><w:spacing w:before="160" w:after="70"/></w:pPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:rPr><w:color w:val="7B8798"/><w:sz w:val="17"/></w:rPr></w:style>'+
  '</w:styles>';
}
function u16(value){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,value,true);return a;}
function u32(value){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,value>>>0,true);return a;}
function concat(parts){
  const size=parts.reduce((sum,p)=>sum+p.length,0),out=new Uint8Array(size);
  let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
let crcTable=null;
function crc32(bytes){
  if(!crcTable){
    crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):(c>>>1);
      crcTable[n]=c>>>0;
    }
  }
  let crc=0xFFFFFFFF;
  for(const b of bytes)crc=crcTable[(crc^b)&0xFF]^(crc>>>8);
  return (crc^0xFFFFFFFF)>>>0;
}
function zipStore(files){
  const enc=new TextEncoder(),locals=[],centrals=[];
  let offset=0;
  for(const file of files){
    const name=enc.encode(file.name),data=typeof file.data==='string'?enc.encode(file.data):file.data;
    const crc=crc32(data),flags=0x0800,method=0,dosTime=0,dosDate=0x21;
    const local=concat([
      u32(0x04034b50),u16(20),u16(flags),u16(method),u16(dosTime),u16(dosDate),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data
    ]);
    locals.push(local);
    const central=concat([
      u32(0x02014b50),u16(20),u16(20),u16(flags),u16(method),u16(dosTime),u16(dosDate),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),
      u32(0),u32(offset),name
    ]);
    centrals.push(central);
    offset+=local.length;
  }
  const centralBlob=concat(centrals),localBlob=concat(locals);
  const end=concat([
    u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),
    u32(centralBlob.length),u32(localBlob.length),u16(0)
  ]);
  return concat([localBlob,centralBlob,end]);
}

export function buildDocxBytes(record){
  const model=buildReportModel(record);
  const files=[
    {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'},
    {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name:'word/document.xml',data:buildDocumentXml(model)},
    {name:'word/styles.xml',data:stylesXml()},
    {name:'word/_rels/document.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'}
  ];
  return zipStore(files);
}

export function downloadWordReport(record){
  const model=buildReportModel(record);
  const bytes=buildDocxBytes(record);
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=cleanFilePart(model.studentName+'_'+model.caseTitle+'_問診評量報告')+'.docx';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export function printPdfReport(record){
  const model=buildReportModel(record);
  const win=window.open('','_blank','width=980,height=760');
  if(!win)throw new Error('POPUP_BLOCKED');
  win.opener=null;
  win.document.open();
  win.document.write(buildReportHtml(record));
  win.document.close();
  const fire=()=>{
    win.focus();
    win.print();
  };
  if(win.document.readyState==='complete')setTimeout(fire,250);
  else win.addEventListener('load',()=>setTimeout(fire,250),{once:true});
  return model;
}
