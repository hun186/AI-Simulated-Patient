import { mockPatientReply } from '../lib/mock-patient.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  const { caseId='aphasia_001', caseDefinition=null, message='', revealedFactIds=[] } = req.body ?? {};
  if (!message.trim()) return res.status(400).json({ error:'message is required' });
  try {
    return res.status(200).json(mockPatientReply({ caseId, caseDefinition, message, revealedFactIds }));
  } catch (error) {
    if (error.message === 'CASE_NOT_FOUND') return res.status(404).json({ error:'Case not found' });
    return res.status(500).json({ error:'Unexpected error' });
  }
}
