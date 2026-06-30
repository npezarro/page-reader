# page-reader

Browser-rendered page content extraction CLI and HTTP proxy.

## Architecture

- `src/index.js` — CLI entry point (`page-reader <url> [options]`)
- `src/server.js` — HTTP proxy server (port 3092, `/fetch?url=<url>`)
- `src/reader.js` — Playwright headless browser: loads URL, waits for network idle
- `src/extractor.js` — Content extraction from rendered DOM (title, text, links, metadata)
- `src/host-guard.js` — SSRF guard: `isInternalHost(host)` blocks RFC1918, loopback, link-local, cloud-metadata
- `src/signals.js` — Post-extraction signal analysis: detects closed jobs, login walls, captchas

## Dev Commands

```bash
npm test          # node --test test/*.test.js (154 tests: extractor, host-guard, reader, signals)
npm run lint      # ESLint v9 flat config
npm start <url>   # Run CLI
```

No build step. ES modules throughout.

## CLI Options

```
node src/index.js <url>
  --text-only    Print visible text only (no JSON)
  --screenshot   Include base64 screenshot in JSON output
  --stealth                Bypass bot detection (randomized fingerprint, domcontentloaded)
  --storage-state <path>  Path to a Playwright storageState JSON (cookies + localStorage) for reading login-walled pages without a live browser. Missing/unreadable file is silently ignored (falls back to anonymous).
  --wait <ms>             Extra settle time after networkidle (default: 2000)
  --timeout <ms>          Navigation timeout (default: 30000)
  --compact               Compact JSON output
```

## HTTP Proxy Server (`src/server.js`)

Runs on port 3092. Accepts `GET /fetch?url=<url>` and proxies the request through the headless browser. `GET /health` returns `{"status":"ok","active":<n>}`. Concurrency cap: 2 simultaneous fetches.

**Block detection:** Every response body is scanned for bot-block signatures (Amazon CAPTCHA, Cloudflare, Distil, Imperva, generic robot-check). On detection, logs `[page-reader BLOCK_DETECTED]` to stderr. If `DISCORD_BLOCK_WEBHOOK` is set (via gitignored `.env`), posts a Discord alert rate-limited to one per domain per hour.

## SSRF Guard (`src/host-guard.js`)

All proxy requests pass through `isInternalHost()` before fetching.

**Correct RFC1918 ranges** (prior implementation bug: `host.startsWith('172.')` blocked 172.0.0.0/8):
- Only `172.16.0.0/12` (172.16.x.x – 172.31.x.x) is private
- `172.217.x.x` (Google) and other 172.x ranges are public — do NOT block them

**Cloud metadata range** — always block `169.254.0.0/16` (link-local):
- `169.254.169.254` is the AWS/GCP instance-metadata endpoint
- Without this, a cloud-hosted proxy is vulnerable to metadata SSRF

**DNS rebinding is NOT protected** — `isInternalHost()` only inspects the hostname string, not the resolved IP. A public hostname resolving to a private IP bypasses the check. Documented in the module header.

## Consumers

- Discord bot — pre-fetches URLs in messages, 3 URLs max, 6000 char each
- Job scraper — URL liveness detection (escalation path after curl + HTML marker checks)
- NLL hunter — fetches JS-rendered Amex pages
- Interactive sessions — `node ~/repos/page-reader/src/index.js --text-only <url>` (on VM: `~/page-reader/`)

## Testing

`npm test` runs all 4 test files via Node.js built-in test runner. Tests are in `test/`:
- `extractor.test.js` — content extraction
- `host-guard.test.js` — SSRF guard (55 tests covering RFC1918, 172.x, 169.254, IPv6, suffixes)
- `reader.test.js` — Playwright integration
- `signals.test.js` — job status signals

## Cross-Cutting Rules

### Testing & CI
- **Pin Node.js to 22 in CI** (current LTS). Don't use `node-version: 'lts/*'` — Node 20 EOL 2026-04-30.
- **Test glob quoting on GitHub Actions:** Single-quoted globs don't expand. Use `test/*.test.js` flat glob.
- **`package-lock.json` must be committed for CI.** Required for `npm ci` + `cache: npm`.
