import { mockEvaluate } from '../lib/mock-evaluator.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { caseId = 'aphasia_001', transcript = [], revealedFactIds = [] } = req.body ?? {};
  try {
    const result = mockEvaluate({ caseId, transcript, revealedFactIds });
    return res.status(200).json(result);
  } catch (error) {
    if (error.message === 'CASE_NOT_FOUND') return res.status(404).json({ error: 'Case not found' });
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
