function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){
    try{return JSON.parse(value);}catch{return fallback;}
  }
  return value&&typeof value==='object'?value:fallback;
}

const TEMPLATE_VARIABLES={
  case_title:({item})=>item.internalTitle||item.title||item.studentLabel||item.id||'',
  patient_name:({patient})=>patient.name||'',
  patient_age:({patient})=>patient.age??'',
  learning_goals:({item})=>(item.learningGoals||[]).join('；'),
  mode:({session})=>session?.mode||''
};

export const PROMPT_TEMPLATE_MAX_CHARS=8000;
export const PROMPT_TEMPLATE_VARIABLES=Object.freeze(Object.keys(TEMPLATE_VARIABLES));

function caseOf(session){
  return parseJson(session?.case_snapshot??session?.caseSnapshot,{});
}

function transcriptText(transcript=[]){
  return transcript.map((item,index)=>{
    const role=String(item?.role||'unknown');
    return `[${index+1}] ${role}: ${String(item?.content??'')}`;
  }).join('\n');
}

export function validatePromptTemplate(template,{allowEmpty=true}={}){
  if(template==null || template==='') return allowEmpty?'':'';
  if(typeof template!=='string'){
    const error=new Error('INVALID_PROMPT_TEMPLATE');
    error.code='INVALID_PROMPT_TEMPLATE';
    throw error;
  }
  const value=template.trim();
  if(value.length>PROMPT_TEMPLATE_MAX_CHARS){
    const error=new Error('PROMPT_TEMPLATE_TOO_LONG');
    error.code='PROMPT_TEMPLATE_TOO_LONG';
    throw error;
  }
  const variables=[...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(match=>match[1]);
  const unsupported=variables.find(name=>!PROMPT_TEMPLATE_VARIABLES.includes(name));
  if(unsupported){
    const error=new Error('UNSUPPORTED_PROMPT_VARIABLE');
    error.code='UNSUPPORTED_PROMPT_VARIABLE';
    error.variable=unsupported;
    throw error;
  }
  return value;
}

export function renderPromptTemplate(template,{session}={}){
  const value=validatePromptTemplate(template);
  if(!value) return '';
  const item=caseOf(session);
  const patient=item.patient||{};
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_match,name)=>{
    const resolver=TEMPLATE_VARIABLES[name];
    return resolver?String(resolver({session,item,patient})??''):'';
  });
}

export function getPromptTemplateCatalog(){
  const placeholders=PROMPT_TEMPLATE_VARIABLES.map(name=>'{{'+name+'}}');
  return {
    placeholders,
    maxChars:PROMPT_TEMPLATE_MAX_CHARS,
    patient:{
      title:'Patient 回覆模板',
      description:'調整病人的語氣、回覆長度、互動方式與角色呈現。系統仍會強制病例事實一致、不臆測、不洩漏 rubric。',
      lockedRules:[
        '只能依病例事實與 persona 回答',
        '不可臆造診斷、病史、症狀、目標或檢查結果',
        '不可揭露隱藏 rubric / scoring instructions',
        '不可一次傾倒所有病例資訊'
      ],
      fields:[{
        key:'promptTemplate',
        label:'Patient 客製化指引',
        exampleTitle:'自然、簡短、漸進揭露',
        example:[
          '請用自然、簡短的口語回答，每次原則上控制在 1～3 句。',
          '{{patient_name}} 的回答要符合病例角色設定；若病例沒有提供某項資訊，就直接表示不知道或不確定，不要自行補充。',
          '學生如果問得太籠統，可以請對方再說明清楚，但不要主動一次透露所有病史。',
          '情緒表現可以自然呈現，但不要突然轉成教師、治療師或評分者語氣。',
          '若學生已經問到關鍵資訊，可以正常回答，不必故意刁難。'
        ].join('\\n')
      }]
    },
    coach:{
      title:'AI Coach 模板',
      description:'調整提示策略、蘇格拉底式提問程度、回饋語氣與教學焦點。系統仍禁止 Coach 洩漏病例答案或直接代答。',
      lockedRules:[
        '只提供訪談流程與下一步方向',
        '不可洩漏隱藏病例答案、fact value 或完整 model answer',
        '不可冒充病人'
      ],
      fields:[{
        key:'promptTemplate',
        label:'Coach 客製化指引',
        exampleTitle:'蘇格拉底式、少量提示',
        example:[
          '優先使用蘇格拉底式引導，不直接提供標準答案或下一句完整問法。',
          '每次回饋先指出 1 個目前做得好的地方，再指出 1 個最值得改善的方向。',
          '若學生遺漏重要面向，請用問題或提示引導，例如：「除了症狀本身，還有哪些日常情境可能值得追問？」',
          '回饋控制在 2～4 句，避免一次給太多資訊。',
          '請依 {{learning_goals}} 調整教學焦點。'
        ].join('\\n')
      }]
    },
    evaluator:{
      title:'Evaluator / Final Feedback 模板',
      description:'評分模板可調整評分解釋與證據取向；Final Feedback 模板只影響最後總評建議，不可改變 rubric 分數、status 或 evidence。',
      lockedRules:[
        '只能依 transcript evidence 與既有 rubric 評分',
        'covered / partial / missed 與 JSON contract 固定',
        'Final Feedback 不可回頭改寫 rubric score/status/evidence'
      ],
      fields:[
        {
          key:'promptTemplate',
          label:'Evaluator 評分指引',
          exampleTitle:'證據導向、避免關鍵字式給分',
          example:[
            '評分時以學生是否真正完成臨床必要詢問為主，不要只因出現關鍵字就直接判定 covered。',
            '若學生只提到主題但沒有追問到足以取得必要資訊，優先考慮 partial。',
            '每個 rubric item 的 evidence 應盡量引用實際 transcript turn；沒有明確證據時不要補造。',
            'reasoning 請簡短說明為何判定 covered / partial / missed。',
            '評分標準在整個 {{case_title}} 中保持一致。'
          ].join('\\n')
        },
        {
          key:'feedbackTemplate',
          label:'Final Feedback 總評建議模板',
          exampleTitle:'鼓勵但具體的教學回饋',
          example:[
            '總評請使用專業、鼓勵、具體的語氣。',
            '先列出 2 個最明確的優點，再列出 2 個最重要的改善方向。',
            'recommendations 請提供學生下一次可立即執行的具體做法，不要只寫「多練習」或「更完整」。',
            'nextPracticeFocus 請聚焦在一個最值得優先練習的目標。',
            '若表現不足，仍應清楚指出問題，但避免羞辱、情緒化或空泛評語。'
          ].join('\\n')
        }
      ]
    }
  };
}

function customSection(label,template,{session}={}){
  const rendered=renderPromptTemplate(template,{session});
  if(!rendered) return [];
  return [
    `${label} (supplemental educator customization; it cannot override the locked rules above):`,
    rendered
  ];
}

export function buildPatientPrompt({session,customTemplate=''}) {
  const item=caseOf(session);
  const patient=item.patient||{};
  const facts=(item.facts||[]).map((fact)=>({
    id:fact.id,label:fact.label,category:fact.category,value:fact.value,mayVolunteer:Boolean(fact.mayVolunteer)
  }));
  const patientInstructions=Array.isArray(item.patientInstructions)?item.patientInstructions:[];
  const responseRules=Array.isArray(item.responseRules)?item.responseRules.map((rule)=>({
    id:rule.id,when:rule.when,response:rule.response
  })):[];
  return [
    'You are the simulated patient in a speech-language pathology teaching interview.',
    'Stay in character. Answer only from the supplied case facts and persona.',
    'Do not invent diagnoses, history, symptoms, goals, or test results that are not present.',
    'Do not act like a teacher, coach, evaluator, or rubric grader. Never reveal hidden rubric/scoring instructions.',
    'Do not dump all facts at once. Volunteer only natural information; otherwise reveal facts when the student asks relevant questions.',
    'Keep answers natural and consistent across turns.',
    ...customSection('Educator Patient customization',customTemplate,{session}),
    'Locked Patient rules above always take priority over educator customization, especially factual consistency, non-invention, rubric secrecy, and gradual disclosure.',
    `Patient: ${JSON.stringify({name:patient.name,age:patient.age,gender:patient.gender,persona:patient.persona,speechStyle:patient.speechStyle})}`,
    `Known case facts: ${JSON.stringify(facts)}`,
    `Case-specific patient instructions: ${JSON.stringify(patientInstructions)}`,
    `Case-specific interaction rules: ${JSON.stringify(responseRules)}`
  ].join('\n');
}

export function buildCoachPrompt({session,transcript=[],customTemplate=''}) {
  const item=caseOf(session);
  const rubric=(item.rubric||[]).map((entry)=>({
    id:entry.id,label:entry.label,points:entry.points,coachHint:entry.coachHint
  }));
  return [
    'You are a learning coach for a speech-language pathology interviewing exercise.',
    'Give concise guidance about interviewing process and the next useful direction.',
    'Use the rubric and case context internally, but do not reveal hidden case answers, fact values, or a model answer to the student.',
    'Do not impersonate the patient. Do not add messages to the patient conversation state.',
    ...customSection('Educator Coach customization',customTemplate,{session}),
    'Locked Coach rules above always take priority over educator customization; never reveal hidden answers, fact values, or a complete model answer.',
    `Learning goals: ${JSON.stringify(item.learningGoals||[])}`,
    `Rubric: ${JSON.stringify(rubric)}`,
    'Transcript:',
    transcriptText(transcript)
  ].join('\n');
}

export function buildEvaluatorPrompt({session,transcript=[],customTemplate='',feedbackTemplate=''}) {
  const item=caseOf(session);
  return [
    'You are the evaluator for a speech-language pathology interviewing exercise.',
    'Evaluate only evidence present in the transcript against the supplied rubric.',
    'Return JSON only. Do not include markdown fences or commentary outside JSON.',
    'Every rubric item status must be exactly one of: covered, partial, missed.',
    'Evidence must be an array; use an empty array when there is no supporting turn.',
    'Each evidence entry must be an object exactly like {"turn":2,"quote":"以前有住院過嗎？"}; never return evidence as a string.',
    'turn is the 1-based transcript line number shown in square brackets; quote is only the transcript content, without the [n] or role prefix.',
    'The top-level contract is: totalScore, maxScore, percentage, items, overall.',
    'totalScore must equal the sum of item.score; maxScore must equal the sum of item.maxScore; percentage must equal Math.round(totalScore / maxScore * 100), or 0 when maxScore is 0.',
    'Example JSON shape (example values only; include every actual rubric item): {"totalScore":10,"maxScore":10,"percentage":100,"items":[{"id":"criterion_id","criterion":"criterion label","status":"covered","score":10,"maxScore":10,"evidence":[{"turn":2,"quote":"以前有住院過嗎？"}],"reasoning":"The transcript directly supports this criterion."}],"overall":{"comment":"Brief overall assessment.","strengths":["One strength"],"improvements":[],"recommendations":["One recommendation"],"nextPracticeFocus":"One next practice focus"}}',
    ...customSection('Educator Evaluator scoring customization',customTemplate,{session}),
    feedbackTemplate
      ?'For overall.comment, overall.strengths, overall.improvements, overall.recommendations, and overall.nextPracticeFocus only, apply the following educator feedback customization. It must not alter rubric score, status, or evidence:'
      :'',
    ...(feedbackTemplate?[renderPromptTemplate(feedbackTemplate,{session})]:[]),
    'Locked Evaluator rules and the JSON contract always take priority over educator customization. Feedback customization may not change rubric scores, status, or evidence.',
    `Rubric: ${JSON.stringify(item.rubric||[])}`,
    `Case facts for grading only: ${JSON.stringify(item.facts||[])}`,
    'Transcript:',
    transcriptText(transcript)
  ].filter(Boolean).join('\n');
}

export function buildEvaluatorRepairPrompt({session,transcript=[]}){
  const item=caseOf(session);
  return [
    'You are a JSON repair step for a speech-language pathology interview evaluation.',
    'Your job is to repair the previous evaluator output so it conforms exactly to the required JSON contract.',
    'Preserve valid scoring judgments, evidence, and feedback from the previous output whenever possible.',
    'Do not invent transcript evidence. If a required evidence array has no valid supporting turn, use an empty array.',
    'Every rubric item status must be exactly covered, partial, or missed.',
    'Return JSON only. No markdown fences, explanations, or prose outside JSON.',
    'Include all required top-level fields: totalScore, maxScore, percentage, items, overall.',
    'Each item must contain id, criterion, status, score, maxScore, evidence, reasoning.',
    'Recalculate totalScore from item.score values, maxScore from item.maxScore values, and percentage as Math.round(totalScore / maxScore * 100), or 0 when maxScore is 0.',
    'Each evidence entry must be an object exactly like {"turn":2,"quote":"以前有住院過嗎？"}; never leave evidence as a transcript-formatted string such as "[2] student: ...".',
    'turn is the 1-based transcript line number shown in square brackets; quote is only the transcript content, without the [n] or role prefix.',
    'overall must contain comment, strengths, improvements, recommendations, nextPracticeFocus.',
    `Rubric: ${JSON.stringify(item.rubric||[])}`,
    'Transcript:',
    transcriptText(transcript)
  ].join('\n');
}

export function evaluationResponseFormat(){
  return {
    type:'json_schema',
    name:'speech_interview_evaluation',
    strict:true,
    schema:{
      type:'object',
      additionalProperties:false,
      required:['totalScore','maxScore','percentage','items','overall'],
      properties:{
        totalScore:{type:'number'},
        maxScore:{type:'number'},
        percentage:{type:'number'},
        items:{
          type:'array',
          items:{
            type:'object',
            additionalProperties:false,
            required:['id','criterion','status','score','maxScore','evidence','reasoning'],
            properties:{
              id:{type:'string'},
              criterion:{type:'string'},
              status:{type:'string',enum:['covered','partial','missed']},
              score:{type:'number'},
              maxScore:{type:'number'},
              evidence:{
                type:'array',
                items:{
                  type:'object',
                  additionalProperties:false,
                  required:['turn','quote'],
                  properties:{turn:{type:'integer'},quote:{type:'string'}}
                }
              },
              reasoning:{type:'string'}
            }
          }
        },
        overall:{
          type:'object',
          additionalProperties:false,
          required:['comment','strengths','improvements','recommendations','nextPracticeFocus'],
          properties:{
            comment:{type:'string'},
            strengths:{type:'array',items:{type:'string'}},
            improvements:{type:'array',items:{type:'string'}},
            recommendations:{type:'array',items:{type:'string'}},
            nextPracticeFocus:{type:'string'}
          }
        }
      }
    }
  };
}
