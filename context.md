# context.md

## Last Updated
2026-08-03 — Added **`--real-chrome`** (+ `--profile-dir`): genuine headed Google Chrome with a persistent profile, auto-wrapped in `xvfb-run`. This is the escalation for **enterprise bot walls that hard-block headless Chromium** (DataDome/PerimeterX). `--stealth` is NOT sufficient for these — it only dresses up headless Chromium, and the vendor fingerprints the browser build. Full closeout: `privateContext/deliverables/closeouts/2026-08-03-datadome-real-chrome-page-access-fix.md`.
2026-06-30 — Added `--storage-state` (Playwright storageState JSON) for authenticated headless reads of login-walled pages. The **VM clone (`~/page-reader/`) is now current and actively used**: employ's `src/lib/link-check.ts` Tier 3 spawns the CLI to verify job-listing liveness (Cloudflare/SPA pages), with optional `PAGE_READER_STORAGE_STATE` for gated pages.
2026-06-05 — Added HTTP-level bot-block detection + Discord webhook alert in `src/server.js`. Defers IP rotation work until WSL residential IP actually gets noticed.

## Current State
- CLI (`node src/index.js <url>`) and HTTP proxy (`src/server.js`, port 3092) both work.
- PM2 process `page-reader-proxy` runs the HTTP server on the WSL host. Reachable from Docker containers via `host.docker.internal:3092`.
- Stealth mode (`--stealth` / `&stealth=true`) successfully bypasses Amazon's WebFetch-targeted bot wall. Verified 2026-06-05 against a real product URL — returned $5,149.00 + "In Stock" + real product name. Used by `shopper-bridge` container's Claude CLI agent as the Amazon access path via `Bash: curl host.docker.internal:3092/fetch?...&stealth=true`.
- **`--real-chrome` works** (verified 2026-08-03 against avis.com, budget.com, travel.calif.aaa.com). Measured on `POST /webapi/reservation/vehicles`: headless Chromium → DataDome `Challenge type: hard_block` (403, unsolvable); real headed Chrome → `device_check_invisible` which auto-solves → **HTTP 200 with real rate data**. Recognise the need for it by `[DataDome Interceptor]` in console, a request to `geo.captcha-delivery.com`, "Access is temporarily restricted", or a results SPA that renders filters but zero result cards. **This is fingerprinting, not volume — IP rotation does not help.**
- Tests: **154/154 pass** (`npm test`).
- Block-detection middleware in `src/server.js` scans every response body for known bot-block signatures (Amazon CAPTCHA, Cloudflare, Distil, Imperva, generic robot-check). On detection, logs structured `[page-reader BLOCK_DETECTED]` to stderr and POSTs to `DISCORD_BLOCK_WEBHOOK` (rate-limited 1/domain/hour). Webhook URL loaded from gitignored `.env`.

## Open Work
- PR #13 (`claude/learnings-629-docs`) has scope creep: originally a docs PR, now also contains the block-detection commit. Either rename or split before merge.
- Remote VM clone at `~/page-reader/` is now CURRENT (pulled 2026-06-30, master with `--storage-state`) and IS called into: employ link-check Tier 3 spawns the CLI. Keep it pulled forward on future page-reader changes.
- **`--real-chrome` is not wired into the HTTP proxy (`src/server.js`) or the VM clone** — CLI only. Docker bridges reach page-reader via `page-reader-proxy` on :3092, which has not been checked for `google-chrome` + `xvfb-run`. Wire it if a bridge ever needs a DataDome-walled site.
- **Pre-existing lint error** in `src/reader.js`: `'document' is not defined` (no-undef) inside a `page.waitForFunction` callback. Predates the 2026-08-03 work (verified by stashing); needs an eslint env/globals fix. ~5 min.
- No automated regression test for the Amazon stealth bypass. If Amazon updates their detection, page-reader could silently start returning CAPTCHA bodies. Block-detection alert is the canary.

## Environment Notes
- **Deploy target:** local host (one process). Remote VM copy exists but is stale and unused.
- **Process manager:** PM2 (`page-reader-proxy`)
- **Port:** 3092 (configurable via `PORT` env var)
- **Node version:** 22.x (uses `--env-file-if-exists`, available in 22.7+)
- **Env loader:** `ecosystem.config.cjs` injects `--env-file-if-exists=.env` so the gitignored `.env` provides `DISCORD_BLOCK_WEBHOOK` without exposing it in the public repo.
- **Browser:** Playwright chromium (installed in node_modules)
- **Consumers:** shopper-bridge container (`host.docker.internal:3092`), discord bot, job scraper, NLL hunter, interactive sessions.

## Active Branch
`claude/learnings-629-docs` (with open PR #13)

---

**Never include:** credentials, API keys, tokens, passwords, or `.env` contents.
**For change history**, see `progress.md`.
