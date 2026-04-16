import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// extractPageData runs in a browser context, reading from `document`.
// We mock `document` on globalThis so the function can be tested without a browser.

/** Minimal mock element */
function makeEl(attrs = {}, text = '') {
  return {
    getAttribute: (name) => attrs[name] ?? null,
    get innerText() { return text; },
    get textContent() { return text; },
    get href() { return attrs.href ?? ''; },
  };
}

/**
 * Build a mock document.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  opts.bodyText
 * @param {Array}   opts.metaTags      - [{name, property, content}]
 * @param {Array}   opts.links         - [{text, href}]
 * @param {Array}   opts.jsonLdScripts - [string] raw JSON
 * @param {boolean} opts.hasPassword
 * @param {Array}   opts.iframeSrcs    - [string] src attributes
 */
function mockDocument({
  title = '',
  bodyText = '',
  metaTags = [],
  links = [],
  jsonLdScripts = [],
  hasPassword = false,
  iframeSrcs = [],
} = {}) {
  const metaEls = metaTags.map((m) =>
    makeEl({ name: m.name, property: m.property, content: m.content })
  );

  const linkEls = links.map((l) =>
    makeEl({ href: l.href }, l.text)
  );

  const jsonLdEls = jsonLdScripts.map((json) => ({
    textContent: json,
  }));

  const passwordEls = hasPassword ? [makeEl()] : [];

  const iframeEls = iframeSrcs.map((src) => makeEl({ src }));

  return {
    title,
    body: { innerText: bodyText },
    querySelector(selector) {
      for (const el of metaEls) {
        // Match meta[name="X"] or meta[property="X"]
        const nameMatch = selector.match(/meta\[name="([^"]+)"\]/);
        if (nameMatch && el.getAttribute('name') === nameMatch[1]) return el;
        const propMatch = selector.match(/meta\[property="([^"]+)"\]/);
        if (propMatch && el.getAttribute('property') === propMatch[1]) return el;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href]') return linkEls;
      if (selector === 'script[type="application/ld+json"]') return jsonLdEls;
      if (selector === 'input[type="password"]') return passwordEls;
      if (selector.includes('iframe[src*=')) return iframeEls.filter((el) => {
        const src = el.getAttribute('src') || '';
        return src.includes('recaptcha') || src.includes('hcaptcha') || src.includes('captcha');
      });
      return [];
    },
  };
}

let extractPageData;
let savedDocument;

beforeEach(async () => {
  savedDocument = globalThis.document;
  // Dynamic import to get fresh module
  const mod = await import('../src/extractor.js');
  extractPageData = mod.extractPageData;
});

afterEach(() => {
  if (savedDocument !== undefined) {
    globalThis.document = savedDocument;
  } else {
    delete globalThis.document;
  }
});

describe('extractPageData — title', () => {
  it('extracts document.title', () => {
    globalThis.document = mockDocument({ title: 'My Page' });
    const result = extractPageData();
    assert.equal(result.title, 'My Page');
  });

  it('returns empty string when title is missing', () => {
    globalThis.document = mockDocument({ title: '' });
    const result = extractPageData();
    assert.equal(result.title, '');
  });
});

describe('extractPageData — meta tags', () => {
  it('extracts description meta by name', () => {
    globalThis.document = mockDocument({
      metaTags: [{ name: 'description', content: 'A cool page' }],
    });
    const result = extractPageData();
    assert.equal(result.meta.description, 'A cool page');
  });

  it('extracts keywords meta', () => {
    globalThis.document = mockDocument({
      metaTags: [{ name: 'keywords', content: 'foo, bar, baz' }],
    });
    const result = extractPageData();
    assert.equal(result.meta.keywords, 'foo, bar, baz');
  });

  it('extracts author meta', () => {
    globalThis.document = mockDocument({
      metaTags: [{ name: 'author', content: 'Jane Doe' }],
    });
    const result = extractPageData();
    assert.equal(result.meta.author, 'Jane Doe');
  });

  it('extracts robots meta', () => {
    globalThis.document = mockDocument({
      metaTags: [{ name: 'robots', content: 'noindex, nofollow' }],
    });
    const result = extractPageData();
    assert.equal(result.meta.robots, 'noindex, nofollow');
  });

  it('returns null for missing meta tags', () => {
    globalThis.document = mockDocument();
    const result = extractPageData();
    assert.equal(result.meta.description, null);
    assert.equal(result.meta.keywords, null);
    assert.equal(result.meta.author, null);
    assert.equal(result.meta.robots, null);
  });
});

describe('extractPageData — Open Graph', () => {
  it('extracts og:title by property', () => {
    globalThis.document = mockDocument({
      metaTags: [{ property: 'og:title', content: 'OG Title' }],
    });
    const result = extractPageData();
    assert.equal(result.ogData.title, 'OG Title');
  });

  it('extracts og:description', () => {
    globalThis.document = mockDocument({
      metaTags: [{ property: 'og:description', content: 'OG Desc' }],
    });
    const result = extractPageData();
    assert.equal(result.ogData.description, 'OG Desc');
  });

  it('extracts og:image', () => {
    globalThis.document = mockDocument({
      metaTags: [{ property: 'og:image', content: 'https://img.example.com/pic.png' }],
    });
    const result = extractPageData();
    assert.equal(result.ogData.image, 'https://img.example.com/pic.png');
  });

  it('extracts og:url, og:type, og:site_name', () => {
    globalThis.document = mockDocument({
      metaTags: [
        { property: 'og:url', content: 'https://example.com' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Example' },
      ],
    });
    const result = extractPageData();
    assert.equal(result.ogData.url, 'https://example.com');
    assert.equal(result.ogData.type, 'website');
    assert.equal(result.ogData.siteName, 'Example');
  });

  it('returns null for missing OG tags', () => {
    globalThis.document = mockDocument();
    const result = extractPageData();
    assert.equal(result.ogData.title, null);
    assert.equal(result.ogData.description, null);
    assert.equal(result.ogData.image, null);
  });
});

describe('extractPageData — text', () => {
  it('extracts body innerText', () => {
    globalThis.document = mockDocument({ bodyText: 'Hello world' });
    const result = extractPageData();
    assert.equal(result.text, 'Hello world');
  });

  it('returns empty string when body has no text', () => {
    globalThis.document = mockDocument({ bodyText: '' });
    const result = extractPageData();
    assert.equal(result.text, '');
  });
});

describe('extractPageData — links', () => {
  it('extracts links with text and href', () => {
    globalThis.document = mockDocument({
      links: [
        { text: 'Google', href: 'https://google.com' },
        { text: 'GitHub', href: 'https://github.com' },
      ],
    });
    const result = extractPageData();
    assert.equal(result.links.length, 2);
    assert.equal(result.links[0].text, 'Google');
    assert.equal(result.links[0].href, 'https://google.com');
  });

  it('filters out links with empty text', () => {
    globalThis.document = mockDocument({
      links: [
        { text: '', href: 'https://example.com' },
        { text: 'Valid', href: 'https://valid.com' },
      ],
    });
    const result = extractPageData();
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].text, 'Valid');
  });

  it('filters out links with empty href', () => {
    globalThis.document = mockDocument({
      links: [
        { text: 'No URL', href: '' },
        { text: 'Has URL', href: 'https://x.com' },
      ],
    });
    const result = extractPageData();
    assert.equal(result.links.length, 1);
  });

  it('truncates link text at 200 chars', () => {
    const longText = 'A'.repeat(300);
    globalThis.document = mockDocument({
      links: [{ text: longText, href: 'https://example.com' }],
    });
    const result = extractPageData();
    assert.equal(result.links[0].text.length, 200);
  });

  it('caps links at 200 items', () => {
    const manyLinks = Array.from({ length: 250 }, (_, i) => ({
      text: `Link ${i}`,
      href: `https://example.com/${i}`,
    }));
    globalThis.document = mockDocument({ links: manyLinks });
    const result = extractPageData();
    assert.equal(result.links.length, 200);
  });

  it('returns empty array when no links', () => {
    globalThis.document = mockDocument();
    const result = extractPageData();
    assert.deepEqual(result.links, []);
  });
});

describe('extractPageData — JSON-LD', () => {
  it('parses valid JSON-LD script', () => {
    globalThis.document = mockDocument({
      jsonLdScripts: ['{"@type": "JobPosting", "title": "Engineer"}'],
    });
    const result = extractPageData();
    assert.equal(result.jsonLd.length, 1);
    assert.equal(result.jsonLd[0]['@type'], 'JobPosting');
  });

  it('parses multiple JSON-LD scripts', () => {
    globalThis.document = mockDocument({
      jsonLdScripts: [
        '{"@type": "Organization", "name": "Acme"}',
        '{"@type": "WebSite", "url": "https://acme.com"}',
      ],
    });
    const result = extractPageData();
    assert.equal(result.jsonLd.length, 2);
  });

  it('skips invalid JSON-LD gracefully', () => {
    globalThis.document = mockDocument({
      jsonLdScripts: ['not valid json', '{"@type": "Valid"}'],
    });
    const result = extractPageData();
    assert.equal(result.jsonLd.length, 1);
    assert.equal(result.jsonLd[0]['@type'], 'Valid');
  });

  it('returns empty array when no JSON-LD', () => {
    globalThis.document = mockDocument();
    const result = extractPageData();
    assert.deepEqual(result.jsonLd, []);
  });
});

describe('extractPageData — password field detection', () => {
  it('detects password field', () => {
    globalThis.document = mockDocument({ hasPassword: true });
    const result = extractPageData();
    assert.equal(result.hasPasswordField, true);
  });

  it('returns false when no password field', () => {
    globalThis.document = mockDocument({ hasPassword: false });
    const result = extractPageData();
    assert.equal(result.hasPasswordField, false);
  });
});

describe('extractPageData — captcha detection', () => {
  it('detects reCAPTCHA iframe', () => {
    globalThis.document = mockDocument({
      iframeSrcs: ['https://www.google.com/recaptcha/api2/anchor'],
    });
    const result = extractPageData();
    assert.equal(result.hasCaptcha, true);
  });

  it('detects hCaptcha iframe', () => {
    globalThis.document = mockDocument({
      iframeSrcs: ['https://hcaptcha.com/captcha/v1/123'],
    });
    const result = extractPageData();
    assert.equal(result.hasCaptcha, true);
  });

  it('returns false when no captcha iframe', () => {
    globalThis.document = mockDocument({
      iframeSrcs: ['https://youtube.com/embed/abc'],
    });
    const result = extractPageData();
    assert.equal(result.hasCaptcha, false);
  });

  it('returns false when no iframes', () => {
    globalThis.document = mockDocument();
    const result = extractPageData();
    assert.equal(result.hasCaptcha, false);
  });
});

describe('extractPageData — full extraction', () => {
  it('returns all expected keys', () => {
    globalThis.document = mockDocument({ title: 'Test', bodyText: 'Content' });
    const result = extractPageData();
    const keys = Object.keys(result).sort();
    assert.deepEqual(keys, [
      'hasCaptcha', 'hasPasswordField', 'jsonLd', 'links',
      'meta', 'ogData', 'text', 'title',
    ]);
  });

  it('extracts a realistic page with all data types', () => {
    globalThis.document = mockDocument({
      title: 'Software Engineer at Acme',
      bodyText: 'We are hiring a software engineer...',
      metaTags: [
        { name: 'description', content: 'Join our team' },
        { property: 'og:title', content: 'SE at Acme' },
        { property: 'og:image', content: 'https://acme.com/logo.png' },
      ],
      links: [
        { text: 'Apply Now', href: 'https://acme.com/apply' },
        { text: 'About Us', href: 'https://acme.com/about' },
      ],
      jsonLdScripts: ['{"@type": "JobPosting", "title": "Software Engineer", "hiringOrganization": {"name": "Acme"}}'],
      hasPassword: false,
      iframeSrcs: [],
    });

    const result = extractPageData();
    assert.equal(result.title, 'Software Engineer at Acme');
    assert.equal(result.meta.description, 'Join our team');
    assert.equal(result.ogData.title, 'SE at Acme');
    assert.equal(result.links.length, 2);
    assert.equal(result.jsonLd[0].title, 'Software Engineer');
    assert.equal(result.hasPasswordField, false);
    assert.equal(result.hasCaptcha, false);
  });
});
