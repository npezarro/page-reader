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
 * @returns {Promise<object>} Structured page data
 */
export async function readPage(url, options = {}) {
  const {
    wait = 2000,
    timeout = 30000,
    screenshot = false,
    stealth = false,
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

    // Extra settle wait for SPAs that load content after networkidle
    if (wait > 0) {
      await page.waitForTimeout(wait);
    }

    const finalUrl = page.url();
    const httpStatus = response ? response.status() : null;

    // Run extraction in page context
    const extracted = await page.evaluate(extractPageDataStr);

    // Analyze signals
    const signals = analyzeSignals(extracted);

    // Determine status
    let status = 'ok';
    if (httpStatus && httpStatus >= 400) {
      status = 'error';
    } else if (finalUrl !== url && new URL(finalUrl).pathname !== new URL(url).pathname) {
      status = 'redirect';
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

// Inline the extractor function as a string for page.evaluate()
// We can't pass module functions directly into page context.
const extractPageDataStr = `(() => {
  const getMeta = (name) => {
    const el =
      document.querySelector('meta[name="' + name + '"]') ||
      document.querySelector('meta[property="' + name + '"]');
    return el ? el.getAttribute('content') : null;
  };

  const title = document.title || '';

  const meta = {
    description: getMeta('description'),
    keywords: getMeta('keywords'),
    author: getMeta('author'),
    robots: getMeta('robots'),
  };

  const ogData = {
    title: getMeta('og:title'),
    description: getMeta('og:description'),
    image: getMeta('og:image'),
    url: getMeta('og:url'),
    type: getMeta('og:type'),
    siteName: getMeta('og:site_name'),
  };

  const text = document.body.innerText || '';

  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({
      text: a.innerText.trim().slice(0, 200),
      href: a.href,
    }))
    .filter((l) => l.text && l.href)
    .slice(0, 200);

  const jsonLd = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  )
    .map((el) => {
      try { return JSON.parse(el.textContent); }
      catch { return null; }
    })
    .filter(Boolean);

  const hasPasswordField = document.querySelectorAll('input[type="password"]').length > 0;

  const hasCaptcha =
    document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"]'
    ).length > 0;

  return { title, meta, ogData, text, links, jsonLd, hasPasswordField, hasCaptcha };
})()`;
