import { mockEvaluate } from '../lib/mock-evaluator.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  const { caseId='aphasia_001', caseDefinition=null, transcript=[], revealedFactIds=[] } = req.body ?? {};
  try {
    return res.status(200).json(mockEvaluate({ caseId, caseDefinition, transcript, revealedFactIds }));
  } catch (error) {
    if (error.message === 'CASE_NOT_FOUND') return res.status(404).json({ error:'Case not found' });
    return res.status(500).json({ error:'Unexpected error' });
  }
}
