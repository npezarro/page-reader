#!/usr/bin/env node

import http from 'http';
import { readPage } from './reader.js';
import { isInternalHost } from './host-guard.js';

const PORT = process.env.PORT || 3092;
const MAX_CONCURRENT = 2;
let active = 0;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', active }));
    return;
  }

  if (req.method !== 'GET' || !req.url.startsWith('/fetch')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const url = params.get('url');

  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url parameter' }));
    return;
  }

  // Validate scheme
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only http/https URLs allowed' }));
      return;
    }
    // Block internal networks (loopback, RFC1918, link-local incl. cloud metadata, etc.)
    if (isInternalHost(parsed.hostname)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal URLs blocked' }));
      return;
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }

  if (active >= MAX_CONCURRENT) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many concurrent requests' }));
    return;
  }

  active++;
  const stealth = params.get('stealth') === 'true';
  const timeout = Math.min(parseInt(params.get('timeout') || '30000', 10), 60000);

  try {
    const result = await readPage(url, { wait: 2000, timeout, stealth, screenshot: false });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(result.text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    active--;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`page-reader proxy listening on 0.0.0.0:${PORT}`);
});
