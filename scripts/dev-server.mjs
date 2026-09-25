import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockPatientReply } from '../lib/mock-patient.js';
import { mockEvaluate } from '../lib/mock-evaluator.js';
import { getPublicCase } from '../lib/cases.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/cases' && req.method === 'GET') return json(res, 200, { cases: [getPublicCase()] });
    if (req.url === '/api/chat' && req.method === 'POST') {
      const data = await body(req);
      return json(res, 200, mockPatientReply({ caseId: data.caseId, message: data.message, revealedFactIds: data.revealedFactIds || [] }));
    }
    if (req.url === '/api/evaluate' && req.method === 'POST') {
      const data = await body(req);
      return json(res, 200, mockEvaluate({ caseId: data.caseId, transcript: data.transcript || [], revealedFactIds: data.revealedFactIds || [] }));
    }
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    if (!['/index.html', '/styles.css', '/app.js'].includes(path)) {
      res.writeHead(404); return res.end('Not found');
    }
    const file = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
    res.end(file);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`AI simulated patient POC: http://localhost:${port}`);
});
