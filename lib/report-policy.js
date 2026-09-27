export const STUDENT_REPORT_EXPORT_POLICIES=Object.freeze([
  'disabled',
  'training_only',
  'all_completed'
]);

export function normalizeStudentReportExportPolicy(value){
  const policy=String(value||'').trim();
  return STUDENT_REPORT_EXPORT_POLICIES.includes(policy)?policy:'training_only';
}

export function canStudentExportReport(policy,mode){
  const normalized=normalizeStudentReportExportPolicy(policy);
  if(normalized==='all_completed') return true;
  if(normalized==='training_only') return String(mode||'training')==='training';
  return false;
}
