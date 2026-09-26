function parseJson(value,fallback={}){
  if(value==null) return fallback;
  if(typeof value==='string'){
    try{return JSON.parse(value);}catch{return fallback;}
  }
  return value&&typeof value==='object'?value:fallback;
}

function caseOf(session){
  return parseJson(session?.case_snapshot??session?.caseSnapshot,{});
}

function transcriptText(transcript=[]){
  return transcript.map((item,index)=>{
    const role=String(item?.role||'unknown');
    return `[${index+1}] ${role}: ${String(item?.content??'')}`;
  }).join('\n');
}

export function buildPatientPrompt({session}){
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
    `Patient: ${JSON.stringify({name:patient.name,age:patient.age,gender:patient.gender,persona:patient.persona,speechStyle:patient.speechStyle})}`,
    `Known case facts: ${JSON.stringify(facts)}`,
    `Case-specific patient instructions: ${JSON.stringify(patientInstructions)}`,
    `Case-specific interaction rules: ${JSON.stringify(responseRules)}`
  ].join('\n');
}

export function buildCoachPrompt({session,transcript=[]}){
  const item=caseOf(session);
  const rubric=(item.rubric||[]).map((entry)=>({
    id:entry.id,label:entry.label,points:entry.points,coachHint:entry.coachHint
  }));
  return [
    'You are a learning coach for a speech-language pathology interviewing exercise.',
    'Give concise guidance about interviewing process and the next useful direction.',
    'Use the rubric and case context internally, but do not reveal hidden case answers, fact values, or a model answer to the student.',
    'Do not impersonate the patient. Do not add messages to the patient conversation state.',
    `Learning goals: ${JSON.stringify(item.learningGoals||[])}`,
    `Rubric: ${JSON.stringify(rubric)}`,
    'Transcript:',
    transcriptText(transcript)
  ].join('\n');
}

export function buildEvaluatorPrompt({session,transcript=[]}){
  const item=caseOf(session);
  return [
    'You are the evaluator for a speech-language pathology interviewing exercise.',
    'Evaluate only evidence present in the transcript against the supplied rubric.',
    'Return JSON only. Do not include markdown fences or commentary outside JSON.',
    'Every rubric item status must be exactly one of: covered, partial, missed.',
    'Evidence must be an array; use an empty array when there is no supporting turn.',
    'The top-level contract is: totalScore, maxScore, percentage, items, overall.',
    `Rubric: ${JSON.stringify(item.rubric||[])}`,
    `Case facts for grading only: ${JSON.stringify(item.facts||[])}`,
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
