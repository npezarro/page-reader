#!/usr/bin/env node

import http from 'http';
import { readPage } from './reader.js';
import { isInternalHost } from './host-guard.js';

const PORT = process.env.PORT || 3092;
const MAX_CONCURRENT = 2;
const BLOCK_WEBHOOK = process.env.DISCORD_BLOCK_WEBHOOK || '';
const BLOCK_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
let active = 0;

const BLOCK_PATTERNS = [
  /to discuss automated access to amazon data/i,
  /enter the characters you see below/i,
  /robot or human/i,
  /sorry.{0,40}we just need to make sure you're not a robot/i,
  /access denied.{0,60}you don't have permission/i,
  /pardon (our|the) interruption/i,
  /are you a robot/i,
  /\bblocked by perimeter/i,
  /security check.{0,40}cloudflare/i,
];

const lastAlertByDomain = new Map();

function detectBlock(text) {
  if (!text || text.length < 200) {
    return text && text.length < 200 ? 'short_body' : null;
  }
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(text)) return pattern.source.slice(0, 60);
  }
  return null;
}

async function alertBlock(targetUrl, reason) {
  let domain;
  try { domain = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { domain = 'unknown'; }
  console.error(`[page-reader BLOCK_DETECTED] domain=${domain} reason="${reason}" url=${targetUrl}`);
  if (!BLOCK_WEBHOOK) return;
  const now = Date.now();
  const last = lastAlertByDomain.get(domain) || 0;
  if (now - last < BLOCK_ALERT_COOLDOWN_MS) return;
  lastAlertByDomain.set(domain, now);
  try {
    await fetch(BLOCK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `:rotating_light: **page-reader blocked** on \`${domain}\`\nreason: ${reason}\nurl: <${targetUrl}>\nWSL residential IP may have been flagged. Consider rotation/proxy if persistent.`,
      }),
    });
  } catch (err) {
    console.error(`[page-reader alert failed] ${err.message}`);
  }
}

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
    const blockReason = detectBlock(result.text);
    if (blockReason) alertBlock(url, blockReason);
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
