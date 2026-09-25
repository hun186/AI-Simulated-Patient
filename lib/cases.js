export const cases = {
  aphasia_001: {
    id: 'aphasia_001',
    title: '中風後語言困難（失語症問診）',
    studentLabel: '案例 A｜成人溝通初診',
    difficulty: '入門',
    studentBrief: '王先生，68 歲，近期因溝通上的困擾前來接受初步評估。請透過問診了解他的目前狀況與相關背景。',
    learningGoals: [
      '建立有結構的語言功能問診流程',
      '釐清語言理解、表達、讀寫與生活參與影響',
      '練習由開放式問題逐步追問重要病史與治療目標'
    ],
    patient: {
      name: '王先生',
      age: 68,
      gender: '男',
      persona: '有點焦慮但願意合作；回答偏短，偶爾找不到詞。不要主動使用醫療專有名詞。',
      speechStyle: '句子短、自然口語；遇到找詞困難時可用「那個……」、「我一時講不出來」呈現。'
    },
    opening: '你好。嗯……我最近講話有點、不太順。',
    facts: [
      { id:'chief_complaint', label:'主要困擾', category:'current_problem', value:'大約三個月前開始覺得講話變慢，常常知道自己想說什麼，但一時找不到詞。', triggers:['怎麼了','哪裡不舒服','主要問題','什麼困擾','講話','語言','說話','症狀'], mayVolunteer:true },
      { id:'onset', label:'發作時間與變化', category:'onset_course', value:'這次明顯的語言困難大約從三個月前開始，最近沒有快速惡化。', triggers:['多久','什麼時候','何時','開始','變嚴重','惡化','進展','三個月'], mayVolunteer:false },
      { id:'stroke_history', label:'中風病史', category:'medical_history', value:'兩年前曾經發生左側腦中風，住院治療後行走恢復得不錯。', triggers:['中風','腦血管','神經','過去病史','病史','住院','以前得過','重大疾病'], mayVolunteer:false },
      { id:'comprehension', label:'理解能力', category:'language_comprehension', value:'一般日常對話大多聽得懂，但別人講太快、句子很長時會比較吃力。', triggers:['聽得懂','理解','別人說話','長句','指令'], mayVolunteer:false },
      { id:'word_finding', label:'找詞困難', category:'expressive_language', value:'最困擾的是找詞，尤其想講人名或物品名稱時，常卡住。', triggers:['找詞','想不起來','叫什麼','名稱','表達','人名','物品'], mayVolunteer:false },
      { id:'reading_writing', label:'讀寫狀況', category:'reading_writing', value:'短句閱讀還可以，但看長篇文章容易累；寫字時偶爾也會想不起某個字。', triggers:['閱讀','讀字','看文章','寫字','書寫','打字'], mayVolunteer:false },
      { id:'swallowing', label:'吞嚥狀況', category:'swallowing_screen', value:'吃飯喝水目前沒有明顯嗆到，也沒有覺得吞不下去。', triggers:['吞嚥','吃飯','喝水','嗆','咳嗽','吞不下'], mayVolunteer:false },
      { id:'daily_impact', label:'生活影響', category:'participation', value:'跟家人聊天還可以，但現在比較不敢接電話，也少跟朋友聚會，怕自己講不出來。', triggers:['生活','工作','社交','家人','朋友','電話','影響','活動'], mayVolunteer:false },
      { id:'family_support', label:'家庭支持', category:'support', value:'太太平常會陪我練習，也會在我講不出來時等我一下。', triggers:['家人','照顧','支持','誰陪','太太','家屬'], mayVolunteer:false },
      { id:'goal', label:'治療期待', category:'goal', value:'希望至少可以比較順地跟人聊天，也想重新自己接電話。', triggers:['希望','目標','期待','想改善','治療想要'], mayVolunteer:false }
    ],
    rubric: [
      { id:'chief', label:'釐清主要語言困擾', factIds:['chief_complaint'], points:15, coachHint:'先用開放式問題釐清病人目前最困擾的事情。' },
      { id:'onset', label:'詢問發作時間與病程', factIds:['onset'], points:10, coachHint:'可追問症狀出現的時間、變化與病程。' },
      { id:'history', label:'詢問重要神經／中風病史', factIds:['stroke_history'], points:15, coachHint:'可補充詢問重要過去病史、住院或治療經驗。' },
      { id:'comprehension', label:'詢問語言理解能力', factIds:['comprehension'], points:10, coachHint:'可探索日常溝通中理解別人說話的情況。' },
      { id:'expression', label:'詢問表達／找詞困難', factIds:['word_finding'], points:15, coachHint:'可探索病人在表達想法、命名或找詞時的實際情況。' },
      { id:'literacy', label:'詢問閱讀與書寫', factIds:['reading_writing'], points:10, coachHint:'可探索閱讀、書寫等其他溝通功能是否受到影響。' },
      { id:'swallowing', label:'進行吞嚥相關初篩', factIds:['swallowing'], points:10, coachHint:'可確認進食與飲水時是否還有其他伴隨困難。' },
      { id:'participation', label:'詢問日常生活與社交影響', factIds:['daily_impact'], points:10, coachHint:'可詢問目前問題對日常活動與社交參與造成哪些影響。' },
      { id:'goal', label:'詢問病人目標／期待', factIds:['goal'], points:5, coachHint:'可詢問病人最希望改善、恢復或重新做到的事情。' }
    ]
  }
};

export function getCase(caseId = 'aphasia_001') { return cases[caseId] ?? null; }

export function isUsableCaseDefinition(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.id === 'string' &&
    typeof value.title === 'string' && value.patient && typeof value.patient.name === 'string' &&
    typeof value.opening === 'string' && Array.isArray(value.facts) &&
    value.facts.every((fact) => fact && typeof fact.id === 'string' && typeof fact.label === 'string' && typeof fact.value === 'string' && Array.isArray(fact.triggers)) &&
    Array.isArray(value.rubric)
  );
}

export function resolveCase(caseId = 'aphasia_001', caseDefinition = null) {
  if (isUsableCaseDefinition(caseDefinition) && caseDefinition.id === caseId) return caseDefinition;
  return getCase(caseId);
}

export function getPublicCase(caseId = 'aphasia_001') {
  const item = getCase(caseId);
  if (!item) return null;
  return {
    id:item.id,
    studentLabel:item.studentLabel || '臨床問診案例',
    difficulty:item.difficulty,
    studentBrief:item.studentBrief || '',
    patient:{ name:item.patient.name, age:item.patient.age, gender:item.patient.gender },
    opening:item.opening
  };
}
