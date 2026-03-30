#!/usr/bin/env node

import { program } from 'commander';
import { readPage } from './reader.js';

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
  .action(async (url, opts) => {
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      const result = await readPage(url, {
        wait: parseInt(opts.wait, 10),
        timeout: parseInt(opts.timeout, 10),
        screenshot: !!opts.screenshot,
        stealth: !!opts.stealth,
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
