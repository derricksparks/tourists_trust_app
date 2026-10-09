// Serves e2e/fixtures/third-party.html on its own port: a stand-in for an operator's website on another origin.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const site = process.env.SITE_URL ?? 'http://localhost:3001';
const html = readFileSync(new URL('./fixtures/third-party.html', import.meta.url), 'utf8').replaceAll('__SITE__', site);
createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)).listen(8088);
