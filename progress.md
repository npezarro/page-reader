# progress.md

## 2026-06-05 — Block detection + Discord alert
- 8da1643 — Add HTTP block detection with Discord webhook alert (pattern scan for Amazon CAPTCHA, Cloudflare, Distil, Imperva, generic robot-check; per-domain rate-limited; reads `DISCORD_BLOCK_WEBHOOK` from gitignored `.env` via PM2 `--env-file-if-exists`)

## Prior commits (already on master / earlier branches)
- 9edec25 — docs: add CLAUDE.md — document HTTP proxy, SSRF guard, and architecture
- b90838a — feat: add HTTP proxy server for headless page fetching
- db45776 — ci: add Dependabot config for automated dependency updates
- 800d3a6 — Add ESLint v9 flat config, fix 2 lint errors (#9)
