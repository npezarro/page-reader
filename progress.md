# progress.md

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
