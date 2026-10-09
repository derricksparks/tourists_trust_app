// Stand-in for api.telegram.org during browser tests (point the API's TELEGRAM_API_BASE here).
// Records every Bot API call; GET /__messages lists them, DELETE /__messages clears them.
import { createServer } from 'node:http';

const calls = [];
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/__messages') {
      if (req.method === 'DELETE') calls.length = 0;
      return res.end(JSON.stringify(calls));
    }
    const method = req.url.split('/').pop();
    calls.push({ method, ...(body ? JSON.parse(body) : {}) });
    res.end(JSON.stringify({ ok: true, result: method === 'getUpdates' ? [] : true }));
  });
}).listen(Number(process.env.FAKE_TELEGRAM_PORT ?? 8099));
