// serve.ts — the ONLY code in the console that touches the read plane, and it does so purely
// by mounting the EXISTING createStateApi().handle() unchanged. It exposes the read plane over
// GET only: any other method is 405. There is no route through which the console could write,
// approve, mint, or execute. (M4 is a static render — no SSE/watcher; that is M5+.)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateApi } from '../../read-plane/state-api/state-api.js';

const api = createStateApi();
const PORT = Number(process.env.CONSOLE_API_PORT ?? 4319);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url)); // built client (prod); absent in dev

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'read-only: only GET is served' }));
    return;
  }
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // State API — delegate verbatim to the existing read plane.
  if (url.pathname.startsWith('/state/') || url.pathname === '/healthz') {
    try {
      const env = api.handle(url.pathname);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(env));
    } catch (e) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }

  // Static built client (prod). In dev, Vite serves the client and proxies /state/* here.
  try {
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, rel);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[console] state API (read-only, GET) on http://localhost:${PORT}`);
});
