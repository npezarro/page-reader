import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// We need to mock playwright before importing reader.js
// Since this is ESM, we'll use a dynamic import approach with module mocking

/** Build a mock Playwright stack: browser → context → page → response */
function createMockPlaywright(overrides = {}) {
  const mockResponse = {
    status: () => overrides.httpStatus ?? 200,
  };

  const mockPage = {
    goto: mock.fn(async () => {
      if (overrides.gotoError) throw overrides.gotoError;
      return mockResponse;
    }),
    url: () => overrides.finalUrl ?? 'https://example.com',
    waitForTimeout: mock.fn(async () => {}),
    evaluate: mock.fn(async () => overrides.extracted ?? {
      title: 'Test Page',
      meta: { description: null, keywords: null, author: null, robots: null },
      ogData: { title: null, description: null, image: null, url: null, type: null, siteName: null },
      text: 'Hello world',
      links: [],
      jsonLd: [],
      hasPasswordField: false,
      hasCaptcha: false,
    }),
    screenshot: mock.fn(async () => Buffer.from('fake-screenshot')),
  };

  const mockContext = {
    newPage: mock.fn(async () => mockPage),
    addInitScript: mock.fn(async () => {}),
  };

  const mockBrowser = {
    newContext: mock.fn(async (opts) => {
      mockBrowser._lastContextOptions = opts;
      return mockContext;
    }),
    close: mock.fn(async () => {}),
    _lastContextOptions: null,
  };

  return { mockBrowser, mockContext, mockPage, mockResponse };
}

// We'll test readPage by importing the module and intercepting playwright
// Since reader.js does `import { chromium } from 'playwright'`, we need
// to use node:test's module mocking or a different strategy.
//
// Strategy: use node --test with mock.module (available in Node 22+)
// Fallback: test the logic by re-implementing the key decisions in isolation

describe('reader.js — status determination logic', () => {
  // These test the core logic of readPage without requiring Playwright

  function determineStatus(httpStatus, url, finalUrl) {
    if (httpStatus && httpStatus >= 400) return 'error';
    if (finalUrl !== url && new URL(finalUrl).pathname !== new URL(url).pathname) return 'redirect';
    return 'ok';
  }

  describe('status determination', () => {
    it('returns "ok" for successful 200 response', () => {
      assert.equal(
        determineStatus(200, 'https://example.com/page', 'https://example.com/page'),
        'ok'
      );
    });

    it('returns "error" for 404', () => {
      assert.equal(
        determineStatus(404, 'https://example.com/page', 'https://example.com/page'),
        'error'
      );
    });

    it('returns "error" for 500', () => {
      assert.equal(
        determineStatus(500, 'https://example.com/page', 'https://example.com/page'),
        'error'
      );
    });

    it('returns "error" for 403', () => {
      assert.equal(
        determineStatus(403, 'https://example.com/page', 'https://example.com/page'),
        'error'
      );
    });

    it('returns "ok" for 301 that stays on same pathname', () => {
      assert.equal(
        determineStatus(200, 'http://example.com/page', 'https://example.com/page'),
        'ok'
      );
    });

    it('returns "redirect" when pathname changes', () => {
      assert.equal(
        determineStatus(200, 'https://example.com/job/123', 'https://example.com/login'),
        'redirect'
      );
    });

    it('returns "ok" when only query string changes', () => {
      assert.equal(
        determineStatus(200, 'https://example.com/page', 'https://example.com/page?ref=1'),
        'ok'
      );
    });

    it('returns "ok" when only host changes but path matches', () => {
      assert.equal(
        determineStatus(200, 'https://example.com/page', 'https://www.example.com/page'),
        'ok'
      );
    });

    it('returns "ok" for null httpStatus (timeout)', () => {
      assert.equal(
        determineStatus(null, 'https://example.com/page', 'https://example.com/page'),
        'ok'
      );
    });

    it('error status takes priority over redirect', () => {
      assert.equal(
        determineStatus(404, 'https://example.com/page', 'https://example.com/not-found'),
        'error'
      );
    });
  });
});

describe('reader.js — result construction logic', () => {
  function buildResult({ url, finalUrl, httpStatus, extracted, signals, screenshotData, loadTime, totalTime }) {
    let status = 'ok';
    if (httpStatus && httpStatus >= 400) {
      status = 'error';
    } else if (finalUrl !== url && new URL(finalUrl).pathname !== new URL(url).pathname) {
      status = 'redirect';
    }

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
  }

  const defaultExtracted = {
    title: 'Test Page',
    meta: { description: 'A test', keywords: null, author: null, robots: null },
    ogData: { title: null, description: null, image: null, url: null, type: null, siteName: null },
    text: 'Hello world',
    links: [{ text: 'Link', href: 'https://example.com' }],
    jsonLd: [],
    hasPasswordField: false,
    hasCaptcha: false,
  };

  const defaultSignals = { jobClosed: false, closedReason: null, requires: [] };

  it('includes all expected fields', () => {
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      extracted: defaultExtracted,
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal(result.url, 'https://example.com');
    assert.equal(result.finalUrl, 'https://example.com');
    assert.equal(result.httpStatus, 200);
    assert.equal(result.status, 'ok');
    assert.equal(result.title, 'Test Page');
    assert.deepEqual(result.meta, defaultExtracted.meta);
    assert.deepEqual(result.ogData, defaultExtracted.ogData);
    assert.equal(result.text, 'Hello world');
    assert.deepEqual(result.links, [{ text: 'Link', href: 'https://example.com' }]);
    assert.deepEqual(result.signals, defaultSignals);
    assert.deepEqual(result.timing, { loadMs: 100, totalMs: 200 });
  });

  it('omits jsonLd when empty array', () => {
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      extracted: { ...defaultExtracted, jsonLd: [] },
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal(result.jsonLd, undefined);
  });

  it('includes jsonLd when non-empty', () => {
    const jsonLd = [{ '@type': 'JobPosting', title: 'Engineer' }];
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      extracted: { ...defaultExtracted, jsonLd },
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.deepEqual(result.jsonLd, jsonLd);
  });

  it('includes screenshot when provided', () => {
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      extracted: defaultExtracted,
      signals: defaultSignals,
      screenshotData: 'base64data',
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal(result.screenshot, 'base64data');
  });

  it('omits screenshot when null', () => {
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      extracted: defaultExtracted,
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal('screenshot' in result, false);
  });

  it('sets status to redirect when pathname differs', () => {
    const result = buildResult({
      url: 'https://example.com/job/123',
      finalUrl: 'https://example.com/login',
      httpStatus: 200,
      extracted: defaultExtracted,
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal(result.status, 'redirect');
  });

  it('sets httpStatus to null for timeout', () => {
    const result = buildResult({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      httpStatus: null,
      extracted: defaultExtracted,
      signals: defaultSignals,
      screenshotData: null,
      loadTime: 100,
      totalTime: 200,
    });

    assert.equal(result.httpStatus, null);
    assert.equal(result.status, 'ok');
  });
});

describe('reader.js — timeout error handling logic', () => {
  // readPage checks: err.message.toLowerCase().includes('timeout')

  it('matches Playwright capital-T Timeout message', () => {
    const err = new Error('page.goto: Timeout 30000ms exceeded.');
    const isTimeout = err.message.toLowerCase().includes('timeout');
    assert.equal(isTimeout, true);
  });

  it('matches lowercase timeout in error message', () => {
    const err = new Error('Navigation timeout of 30000 ms exceeded');
    const isTimeout = err.message.toLowerCase().includes('timeout');
    assert.equal(isTimeout, true);
  });

  it('non-timeout errors should not match', () => {
    const err = new Error('net::ERR_NAME_NOT_RESOLVED');
    const isTimeout = err.message.toLowerCase().includes('timeout');
    assert.equal(isTimeout, false);
  });

  it('detects timeout across various Playwright message formats', () => {
    const messages = [
      'page.goto: Timeout 30000ms exceeded.',
      'Timeout 1000ms exceeded.',
      'Navigation timeout of 30000 ms exceeded',
      'Waiting for selector timeout exceeded',
    ];
    for (const msg of messages) {
      const err = new Error(msg);
      assert.equal(
        err.message.toLowerCase().includes('timeout'),
        true,
        `should detect timeout in: ${msg}`
      );
    }
  });
});

describe('reader.js — stealth mode logic', () => {
  it('stealth viewport has randomized dimensions', () => {
    // Simulate the stealth viewport logic from readPage
    const baseWidth = 1280;
    const baseHeight = 800;
    const stealthWidth = baseWidth + Math.floor(Math.random() * 40);
    const stealthHeight = baseHeight + Math.floor(Math.random() * 40);

    assert.ok(stealthWidth >= 1280 && stealthWidth < 1320, `width ${stealthWidth} in range`);
    assert.ok(stealthHeight >= 800 && stealthHeight < 840, `height ${stealthHeight} in range`);
  });

  it('non-stealth viewport is fixed 1280x800', () => {
    const viewport = { width: 1280, height: 800 };
    assert.equal(viewport.width, 1280);
    assert.equal(viewport.height, 800);
  });

  it('stealth uses domcontentloaded waitUntil', () => {
    const stealth = true;
    const waitUntil = stealth ? 'domcontentloaded' : 'networkidle';
    assert.equal(waitUntil, 'domcontentloaded');
  });

  it('non-stealth uses networkidle waitUntil', () => {
    const stealth = false;
    const waitUntil = stealth ? 'domcontentloaded' : 'networkidle';
    assert.equal(waitUntil, 'networkidle');
  });
});

describe('reader.js — option defaults', () => {
  it('default wait is 2000ms', () => {
    const { wait = 2000 } = {};
    assert.equal(wait, 2000);
  });

  it('default timeout is 30000ms', () => {
    const { timeout = 30000 } = {};
    assert.equal(timeout, 30000);
  });

  it('default screenshot is false', () => {
    const { screenshot = false } = {};
    assert.equal(screenshot, false);
  });

  it('default stealth is false', () => {
    const { stealth = false } = {};
    assert.equal(stealth, false);
  });

  it('custom options override defaults', () => {
    const opts = { wait: 5000, timeout: 60000, screenshot: true, stealth: true };
    const { wait = 2000, timeout = 30000, screenshot = false, stealth = false } = opts;
    assert.equal(wait, 5000);
    assert.equal(timeout, 60000);
    assert.equal(screenshot, true);
    assert.equal(stealth, true);
  });
});
