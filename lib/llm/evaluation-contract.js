const VALID_STATUS=new Set(['covered','partial','missed']);

function invalid(message='INVALID_EVALUATION_CONTRACT'){
  const error=new Error(message);
  error.code='INVALID_EVALUATION_CONTRACT';
  return error;
}

function number(value,name,{min=0,max=Infinity}={}){
  if(typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) throw invalid(name);
  return value;
}

function strings(value,name){
  if(!Array.isArray(value) || value.some(item=>typeof item!=='string')) throw invalid(name);
  return value.slice();
}

export function validateEvaluationContract(value){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw invalid();
  const totalScore=number(value.totalScore,'totalScore');
  const maxScore=number(value.maxScore,'maxScore');
  const percentage=number(value.percentage,'percentage',{min:0,max:100});
  if(maxScore===0 && totalScore!==0) throw invalid('score');
  if(totalScore>maxScore) throw invalid('score');

  if(!Array.isArray(value.items)) throw invalid('items');
  const items=value.items.map((item)=>{
    if(!item || typeof item!=='object' || Array.isArray(item)) throw invalid('item');
    if(typeof item.id!=='string' || !item.id) throw invalid('item.id');
    if(typeof item.criterion!=='string' || !item.criterion) throw invalid('item.criterion');
    if(!VALID_STATUS.has(item.status)) throw invalid('item.status');
    const score=number(item.score,'item.score');
    const itemMax=number(item.maxScore,'item.maxScore');
    if(score>itemMax) throw invalid('item.score');
    if(!Array.isArray(item.evidence)) throw invalid('item.evidence');
    const evidence=item.evidence.map((entry)=>{
      if(!entry || typeof entry!=='object' || !Number.isInteger(entry.turn) || entry.turn<1 || typeof entry.quote!=='string'){
        throw invalid('item.evidence');
      }
      return {turn:entry.turn,quote:entry.quote};
    });
    if(typeof item.reasoning!=='string') throw invalid('item.reasoning');
    return {
      id:item.id,criterion:item.criterion,status:item.status,score,maxScore:itemMax,
      evidence,reasoning:item.reasoning
    };
  });

  const overall=value.overall;
  if(!overall || typeof overall!=='object' || Array.isArray(overall)) throw invalid('overall');
  if(typeof overall.comment!=='string' || typeof overall.nextPracticeFocus!=='string') throw invalid('overall');
  const normalized={
    totalScore,maxScore,percentage,items,
    overall:{
      comment:overall.comment,
      strengths:strings(overall.strengths,'overall.strengths'),
      improvements:strings(overall.improvements,'overall.improvements'),
      recommendations:strings(overall.recommendations,'overall.recommendations'),
      nextPracticeFocus:overall.nextPracticeFocus
    }
  };
  return normalized;
}

export function parseAndValidateEvaluation(text){
  let value;
  try{value=JSON.parse(String(text));}
  catch(error){throw invalid('INVALID_EVALUATION_JSON');}
  return validateEvaluationContract(value);
}
