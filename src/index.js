#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { program } from 'commander';
import { readPage } from './reader.js';

// --real-chrome needs a real X display (Chrome is launched headed). Always
// re-exec under Xvfb: WSL exports DISPLAY=:0 with no X server behind it, so
// the presence of DISPLAY proves nothing. Xvfb is correct for automation
// regardless, and is a no-op cost when a real display does exist.
if (process.argv.includes('--real-chrome') && !process.env.PAGE_READER_XVFB) {
  const r = spawnSync(
    'xvfb-run',
    ['-a', '--server-args=-screen 0 1600x1050x24', process.execPath, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, PAGE_READER_XVFB: '1' } },
  );
  if (r.error) {
    console.error(
      JSON.stringify(
        { status: 'error', error: `--real-chrome needs xvfb-run (or a DISPLAY): ${r.error.message}` },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

program
  .name('page-reader')
  .description('Load a URL in a headless browser and extract structured page content')
  .version('1.0.0')
  .argument('<url>', 'URL to load and extract content from')
  .option('--wait <ms>', 'Extra settle time after networkidle (ms)', '2000')
  .option('--timeout <ms>', 'Navigation timeout (ms)', '30000')
  .option('--screenshot', 'Include a base64 screenshot in output')
  .option('--text-only', 'Output only the visible text, no JSON')
  .option('--compact', 'Compact JSON output (no pretty-print)')
  .option('--stealth', 'Stealth mode: bypass bot detection (uses domcontentloaded, randomized fingerprint)')
  .option('--storage-state <path>', 'Path to a Playwright storageState JSON (cookies + localStorage) for reading login-walled pages without a live human browser')
  .option('--real-chrome', 'Use real Google Chrome, headed, with a persistent profile. Beats enterprise bot walls (DataDome/PerimeterX) that hard-block headless Chromium. Auto-wraps in xvfb-run when there is no DISPLAY.')
  .option('--profile-dir <path>', 'Profile directory for --real-chrome (default ~/.cache/page-reader/chrome-profile). Reusing one profile accrues bot-vendor trust cookies.')
  .action(async (url, opts) => {
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      // Validate scheme (prevent SSRF via file://, ftp://, etc.)
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Blocked scheme "${parsed.protocol}" — only http: and https: are allowed`);
      }

      const result = await readPage(url, {
        wait: parseInt(opts.wait, 10),
        timeout: parseInt(opts.timeout, 10),
        screenshot: !!opts.screenshot,
        stealth: !!opts.stealth,
        storageState: opts.storageState || undefined,
        realChrome: !!opts.realChrome,
        profileDir: opts.profileDir || undefined,
      });

      if (opts.textOnly) {
        process.stdout.write(result.text);
      } else {
        const indent = opts.compact ? undefined : 2;
        console.log(JSON.stringify(result, null, indent));
      }
    } catch (err) {
      const errorResult = {
        url,
        status: 'error',
        error: err.message,
      };
      console.error(JSON.stringify(errorResult, null, 2));
      process.exit(1);
    }
  });

program.parse();
