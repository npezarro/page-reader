import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { extractPageData } from './extractor.js';
import { analyzeSignals } from './signals.js';

/**
 * Load a URL in a headless browser and extract structured page content.
 *
 * @param {string} url - The URL to load
 * @param {object} options
 * @param {number} options.wait - Extra settle time in ms after networkidle (default 2000)
 * @param {number} options.timeout - Navigation timeout in ms (default 30000)
 * @param {boolean} options.screenshot - Capture a screenshot as base64
 * @param {boolean} options.stealth - Stealth mode: bypass bot detection
 * @param {string} options.storageState - Path to a Playwright storageState JSON
 *   (cookies + localStorage) so a headless browser can read login-walled pages
 *   without a live human browser. Missing/invalid file is ignored (anonymous).
 * @returns {Promise<object>} Structured page data
 */
export async function readPage(url, options = {}) {
  const {
    wait = 2000,
    timeout = 30000,
    screenshot = false,
    stealth = false,
    storageState = undefined,
  } = options;

  const startTime = Date.now();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };

    // Authenticated session for login-walled pages. Tolerate a missing/unreadable
    // file: fall back to an anonymous context rather than failing the read.
    if (storageState) {
      try {
        await fs.access(storageState);
        contextOptions.storageState = storageState;
      } catch {
        /* no session file -> anonymous */
      }
    }

    if (stealth) {
      // Randomize viewport slightly to avoid fingerprinting
      contextOptions.viewport = {
        width: 1280 + Math.floor(Math.random() * 40),
        height: 800 + Math.floor(Math.random() * 40),
      };
      contextOptions.locale = 'en-US';
      contextOptions.timezoneId = 'America/Los_Angeles';
    }

    const context = await browser.newContext(contextOptions);

    if (stealth) {
      // Remove navigator.webdriver flag that reveals automation
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
    }

    const page = await context.newPage();

    // Navigate — stealth uses domcontentloaded to avoid waiting on
    // analytics/tracking requests that may never resolve when blocked
    const waitUntil = stealth ? 'domcontentloaded' : 'networkidle';
    let response;
    try {
      response = await page.goto(url, {
        waitUntil,
        timeout,
      });
    } catch (err) {
      if (err.message.toLowerCase().includes('timeout')) {
        // Page didn't fully settle but may still have content — continue
        response = null;
      } else {
        throw err;
      }
    }

    const loadTime = Date.now() - startTime;

    // Cloudflare challenge detection and resolution
    const cfMitigated = response?.headers()?.['cf-mitigated'];
    if (cfMitigated === 'challenge' || (response && response.status() === 403)) {
      // Wait for CF challenge to auto-resolve (up to 12s)
      try {
        await page.waitForFunction(
          () => {
            const text = document.body?.innerText || '';
            // Content appeared beyond the challenge spinner
            return (
              text.length > 200 ||
              text.includes('Apply') ||
              text.includes('404') ||
              text.includes('not found')
            );
          },
          { timeout: 12000 }
        );
      } catch {
        // Challenge didn't resolve; continue with whatever we have
      }
    }

    // Extra settle wait for SPAs that load content after networkidle
    if (wait > 0) {
      await page.waitForTimeout(wait);
    }

    const finalUrl = page.url();
    const httpStatus = response ? response.status() : null;

    // Run extraction in page context
    const extracted = await page.evaluate(extractPageData);

    // Analyze signals
    const signals = analyzeSignals(extracted);

    // Determine status
    let status = 'ok';
    if (httpStatus && httpStatus >= 400) {
      status = 'error';
    } else {
      // Normalize both URLs before comparing: strip trailing slashes, coerce to https
      const normalize = (u) => {
        try {
          const parsed = new URL(u);
          parsed.protocol = 'https:';
          parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
          return parsed.href;
        } catch {
          return u;
        }
      };
      if (normalize(finalUrl) !== normalize(url)) {
        status = 'redirect';
      }
    }

    // Screenshot if requested
    let screenshotData = undefined;
    if (screenshot) {
      const buf = await page.screenshot({ fullPage: true });
      screenshotData = buf.toString('base64');
    }

    const totalTime = Date.now() - startTime;

    return {
      url,
      finalUrl,
      httpStatus,
      status,
      title: extracted.title,
      meta: extracted.meta,
      ogData: extracted.ogData,
      text: extracted.text,
      links: extracted.links,
      jsonLd: extracted.jsonLd.length > 0 ? extracted.jsonLd : undefined,
      signals,
      timing: { loadMs: loadTime, totalMs: totalTime },
      ...(screenshotData && { screenshot: screenshotData }),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

