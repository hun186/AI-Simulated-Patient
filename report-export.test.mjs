import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportModel,buildReportHtml,buildDocxBytes } from './report-export.js';

const sample={
  id:'session-report-1',
  caseTitle:'案例｜聲帶結節',
  studentUserId:'student-1',
  studentName:'王同學',
  teachers:[{id:'teacher-1',displayName:'林老師'}],
  teacherSource:'session_snapshot',
  mode:'training',
  coachEnabled:true,
  coachUsed:true,
  startedAt:'2026-09-27T01:00:00.000Z',
  endedAt:'2026-09-27T01:20:00.000Z',
  transcript:[
    {role:'patient',content:'你好。',at:'2026-09-27T01:00:00.000Z'},
    {role:'student',content:'你的聲音沙啞多久了？',at:'2026-09-27T01:01:00.000Z'},
    {role:'patient',content:'大概半年多了。',at:'2026-09-27T01:01:02.000Z'}
  ],
  coachEvents:[{
    at:'2026-09-27T01:01:03.000Z',
    lastQuestion:{text:'你的聲音沙啞多久了？',level:'good',comment:'能聚焦病程時間。'},
    nextHint:'接著可詢問症狀變化。',
    reflectionPrompt:'想想症狀何時最嚴重。'
  }],
  llmRoutes:{
    patient:{preset:'dify',providerKind:'dify',model:'chat'},
    coach:{preset:'openai',providerKind:'openai',model:'gpt-5-mini'},
    evaluator:{preset:'deepseek',providerKind:'openai_compatible',model:'deepseek-flash'}
  },
  llmUsage:[
    {agentType:'patient',success:true,totalTokens:100,estimatedCostMicrousd:0,estimatedCostMicrontd:0},
    {agentType:'coach',success:true,totalTokens:80,estimatedCostMicrousd:1000,estimatedCostMicrontd:31780},
    {agentType:'evaluator',success:true,totalTokens:200,estimatedCostMicrousd:5000,estimatedCostMicrontd:158900}
  ],
  evaluation:{
    totalScore:11,maxScore:14,percentage:78.6,
    items:[{
      id:'H01',criterion:'主訴',status:'covered',score:1,maxScore:1,
      evidence:[{turn:2,quote:'你的聲音沙啞多久了？'}],
      reasoning:'有詢問主要嗓音問題與病程。'
    }],
    overall:{
      comment:'整體問診結構良好。',
      strengths:['能詢問病程'],
      improvements:['補充聲音休息情形'],
      recommendations:['加入工作環境追問'],
      nextPracticeFocus:'工作環境與聲音休息'
    }
  }
};

test('report model preserves people timing AI provenance and evaluation',()=>{
  const model=buildReportModel(sample);
  assert.equal(model.studentName,'王同學');
  assert.equal(model.teachers[0].displayName,'林老師');
  assert.equal(model.duration,'20 分鐘');
  assert.equal(model.coachEvents.length,1);
  assert.equal(model.routes.patient.preset,'dify');
  assert.equal(model.usageByAgent.patient.calls,1);
  assert.equal(model.usageByAgent.evaluator.totalTokens,200);
  assert.equal(model.evaluation.percentage,78.6);
});

test('print-ready report HTML contains all requested report sections',()=>{
  const html=buildReportHtml(sample);
  for(const text of [
    '問診學習與評量報告','做答人','林老師','AI / LLM 執行資訊',
    'Dify · chat','完整問答紀錄','AI Coach 訓練紀錄','結束評量',
    'Rubric 評量明細','你的聲音沙啞多久了？','工作環境與聲音休息'
  ]) assert.equal(html.includes(text),true,text);
  assert.match(html,/@page\{size:A4/);
});

test('Word report is a real DOCX OpenXML ZIP package',()=>{
  const bytes=buildDocxBytes(sample);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0],0x50);
  assert.equal(bytes[1],0x4b);
  assert.ok(bytes.length>2000);
  const raw=new TextDecoder().decode(bytes);
  assert.match(raw,/\[Content_Types\]\.xml/);
  assert.match(raw,/word\/document\.xml/);
  assert.match(raw,/word\/styles\.xml/);
  assert.match(raw,/問診學習與評量報告/);
  assert.match(raw,/Dify · chat/);
  assert.match(raw,/AI Coach 訓練紀錄/);
});


test('Teacher record UI wires Word and PDF export actions',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const html=readFileSync('index.html','utf8');
  assert.match(app,/import \{ downloadWordReport,printPdfReport \} from '\.\/report-export\.js'/);
  assert.match(app,/function exportSelectedWord/);
  assert.match(app,/function exportSelectedPdf/);
  assert.match(app,/downloadWordReport\(record\)/);
  assert.match(app,/printPdfReport\(record\)/);
  assert.match(html,/id="exportRecordWordBtn"/);
  assert.match(html,/id="exportRecordPdfBtn"/);
});


test('Student report export UI follows per-case policy and keeps Teacher export separate',()=>{
  const app=readFileSync('formal-app.js','utf8');
  const html=readFileSync('index.html','utf8');
  const server=readFileSync('scripts/dev-server.mjs','utf8');
  const teacherCases=readFileSync('api/teacher/cases.js','utf8');
  const studentReport=readFileSync('api/student/report.js','utf8');

  assert.match(app,/training_only:'僅訓練模式可下載'/);
  assert.match(app,/all_completed:'訓練與考試完成後皆可下載'/);
  assert.match(app,/function studentCanExport/);
  assert.match(app,/function exportOwnStudentWord/);
  assert.match(app,/function exportOwnStudentPdf/);
  assert.match(app,/action:'setStudentReportExportPolicy'/);
  assert.match(html,/id="studentReportExportActions"/);
  assert.match(html,/id="studentExportWordBtn"/);
  assert.match(html,/id="studentExportPdfBtn"/);
  assert.match(html,/id="builderStudentReportPolicy"/);
  assert.match(teacherCases,/setStudentReportExportPolicy/);
  assert.match(studentReport,/STUDENT_REPORT_EXPORT_NOT_ALLOWED/);
  assert.match(studentReport,/s\.student_user_id=\$2/);
  assert.doesNotMatch(studentReport,/estimated_cost_microusd/);
  assert.doesNotMatch(studentReport,/estimated_cost_microntd/);
  assert.match(server,/\['\/api\/student\/report',studentReportHandler\]/);
  assert.match(server,/'\/report-export\.js'/);
});
