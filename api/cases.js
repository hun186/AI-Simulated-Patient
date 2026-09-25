import { getPublicCase } from '../lib/cases.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(200).json({ cases: [getPublicCase('aphasia_001')] });
}
