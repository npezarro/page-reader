# context.md

## Last Updated
2026-06-05 — Added HTTP-level bot-block detection + Discord webhook alert in `src/server.js`. Defers IP rotation work until WSL residential IP actually gets noticed.

## Current State
- CLI (`node src/index.js <url>`) and HTTP proxy (`src/server.js`, port 3092) both work.
- PM2 process `page-reader-proxy` runs the HTTP server on the WSL host. Reachable from Docker containers via `host.docker.internal:3092`.
- Stealth mode (`--stealth` / `&stealth=true`) successfully bypasses Amazon's WebFetch-targeted bot wall. Verified 2026-06-05 against a real product URL — returned $5,149.00 + "In Stock" + real product name. Used by `shopper-bridge` container's Claude CLI agent as the Amazon access path via `Bash: curl host.docker.internal:3092/fetch?...&stealth=true`.
- Block-detection middleware in `src/server.js` scans every response body for known bot-block signatures (Amazon CAPTCHA, Cloudflare, Distil, Imperva, generic robot-check). On detection, logs structured `[page-reader BLOCK_DETECTED]` to stderr and POSTs to `DISCORD_BLOCK_WEBHOOK` (rate-limited 1/domain/hour). Webhook URL loaded from gitignored `.env`.

## Open Work
- PR #13 (`claude/learnings-629-docs`) has scope creep: originally a docs PR, now also contains the block-detection commit. Either rename or split before merge.
- Remote VM mirror at `~/page-reader/` is stale (April, no server.js, no host-guard, no stealth). Currently unused — remote apps don't call into page-reader yet. Leave stale or sync; no impact today.
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
