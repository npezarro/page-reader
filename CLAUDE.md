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
  --real-chrome            Use real headed Google Chrome with a persistent profile (auto-wraps in xvfb-run when there's no X display). Bypasses enterprise bot walls (DataDome/PerimeterX) that hard-block headless Chromium; `--stealth` is not sufficient for these. CLI only — not wired into the HTTP proxy.
  --profile-dir <path>     Profile directory for --real-chrome (default: ~/.cache/page-reader/chrome-profile)
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
- employ link-check — `src/lib/link-check.ts` Tier 3 spawns the CLI to verify job-listing liveness on Cloudflare/SPA pages; uses `--storage-state` (via `PAGE_READER_STORAGE_STATE` env var) for login-walled pages. VM clone (`~/page-reader/`) must be kept current.
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

### Deployment (page-reader-proxy)

The HTTP proxy server runs on the VM under PM2 as `page-reader-proxy` (port 3092, `ecosystem.config.cjs`). The VM clone lives at `~/page-reader/`; deploying means updating that clone and restarting the process. Building/passing CI is not deploying — "it built clean" is not "it works."

**Pre-deploy checklist:**
1. All changes committed and pushed.
2. Tests pass (`npm test`) and lint is clean (`npm run lint`).
3. Dependencies are locked (`package-lock.json` committed). **If `package.json` or `package-lock.json` changed, run `npm install` on the VM target before restarting** — missing this causes crash loops from missing modules.
4. No secrets exposed. The local `.env` holding `DISCORD_BLOCK_WEBHOOK` is gitignored; never commit it.

**Deploy:** Route PM2-service deploys through the `deploy` skill rather than ad-hoc `ssh + pm2 restart`. The deploy is: `git pull` on the VM clone, `npm install` if dependencies changed, then `pm2 restart page-reader-proxy`.

**Post-deploy verification (run within 30 seconds):**
1. `pm2 show page-reader-proxy` — confirm status is `online`, uptime climbing, restart count not spiking.
2. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3092/health` — confirm HTTP 200 (`{"status":"ok",...}`).
3. `pm2 logs page-reader-proxy --lines 20` — scan for errors, uncaught exceptions, or crash loops in the first 30 seconds.
4. **Deploy after every change** to the deployed proxy; don't accumulate commits without deploying. If you intentionally batch, note the pending deploy in `context.md`.
5. If any check fails, **do not move on** — diagnose and fix before declaring the deploy complete.

### Discord Block Alerts

`alertBlock()` in `src/server.js` posts to a Discord webhook (`DISCORD_BLOCK_WEBHOOK`) when a fetched page matches a bot-block signature. From `agentGuidance/guidance/discord-integration.md`:

- **Keep alerting opt-in and fail-open.** Posting is skipped entirely when the env var is unset, and the POST is wrapped in `try/catch` so a webhook failure only logs. Never couple a `/fetch` response to Discord being reachable, and don't add unconditional posting to other code paths — external posting stays behind an explicit opt-in.
- **Discord messages are capped at 2000 characters** (embed descriptions at 4096). The alert body interpolates the target URL, so a pathological URL pushes the payload over the cap; Discord rejects the whole message with a 400 and the `catch` swallows it, so the alert is silently lost. Truncate interpolated values (URL, reason) before building the payload.
- **Keep the per-domain cooldown.** One alert per domain per hour. A block that repeats on every request would otherwise flood the channel and get rate-limited by Discord, burying the first (useful) alert.
- **Send a `User-Agent: DiscordBot (<url>, <version>)` header on the POST.** Discord's webhook endpoint sits behind Cloudflare, which rejects requests carrying a default HTTP-client User-Agent (Node's built-in `fetch`, `python-urllib`, bare `curl`) at the edge with `HTTP 403` and the body `{"code": 1010}`. `alertBlock()` currently sets only `Content-Type`, so an alert can be dropped before it ever reaches Discord. The diagnostic tell is code `1010` with no `message` field — Discord's own permission failures come back as 403 with code `50001`/`50013` and a human-readable message. Because the rejection is at the edge, the webhook URL is not the problem and retrying an unchanged request never succeeds.
- **Check the response status — a non-2xx `fetch` does not throw.** The `try/catch` around the POST only fires on network/DNS errors, so a 403 (Cloudflare bot block) or a 400 (over the 2000-char cap) resolves normally and the alert is lost with *no log line at all*. Read `res.ok`/`res.status` and log the status plus a truncated body when the post fails. Delivery still fails open — a broken webhook must never break `/fetch` — but it must never fail silently, or a monitoring channel that has stopped receiving alerts is indistinguishable from one with nothing to report.
