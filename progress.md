# progress.md

## 2026-08-03 — `--real-chrome`: defeat enterprise bot walls (DataDome/PerimeterX)
- df1dbf3 — Add `--real-chrome` + `--profile-dir`. Launches genuine Google Chrome (`channel: 'chrome'`), headed, via `launchPersistentContext` with a reusable profile at `~/.cache/page-reader/chrome-profile`; auto-re-execs under `xvfb-run` (guarded by `PAGE_READER_XVFB`). UA override deliberately dropped in this mode. Tests 154/154 green.
  - **Why:** headless Chromium is `hard_block`ed by DataDome on XHR APIs — avis.com/budget.com `POST /webapi/reservation/vehicles` returns 403 `Challenge type: hard_block`, and `travel.calif.aaa.com` renders an empty results SPA. Real headed Chrome is served the solvable `device_check_invisible` instead and clears it itself → HTTP 200 with real data.
  - `--stealth` does **not** help: it only dresses up headless Chromium, and the vendor fingerprints the browser build.
  - `$DISPLAY` cannot gate the Xvfb wrap: WSL exports `DISPLAY=:0` with no X server behind it.

## 2026-06-30 — `--storage-state` for authenticated headless reads
- `5f6f818` — Add `--storage-state <path>` (Playwright storageState JSON: cookies +
  localStorage) so an always-on headless browser can read login-walled pages (LinkedIn,
  gated ATS) without a live human browser. Missing/unreadable file falls back to an
  anonymous context. Consumed by employ's `src/lib/link-check.ts` Tier 3 via
  `PAGE_READER_STORAGE_STATE`. Pulled to the VM clone; test suite green.

## 2026-06-05 — Block detection + Discord alert
- 8da1643 — Add HTTP block detection with Discord webhook alert (pattern scan for Amazon CAPTCHA, Cloudflare, Distil, Imperva, generic robot-check; per-domain rate-limited; reads `DISCORD_BLOCK_WEBHOOK` from gitignored `.env` via PM2 `--env-file-if-exists`)

## Prior commits (already on master / earlier branches)
- 9edec25 — docs: add CLAUDE.md — document HTTP proxy, SSRF guard, and architecture
- b90838a — feat: add HTTP proxy server for headless page fetching
- db45776 — ci: add Dependabot config for automated dependency updates
- 800d3a6 — Add ESLint v9 flat config, fix 2 lint errors (#9)
