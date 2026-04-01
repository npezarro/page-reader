import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSignals } from '../src/signals.js';

/** Helper to build a minimal extracted page object */
function makePage(overrides = {}) {
  return {
    text: '',
    hasPasswordField: false,
    hasCaptcha: false,
    jsonLd: [],
    ...overrides,
  };
}

describe('analyzeSignals', () => {
  // ── Job Closed Detection (text patterns) ──────────────────────────

  describe('job closed detection', () => {
    const closedPhrases = [
      'This position is no longer accepting applications.',
      'Sorry, this position has been filled.',
      'This job is closed',
      'This role has been closed and is no longer available.',
      'This position has been filled by another candidate.',
      'This job is no longer available',
      'This posting has expired',
      'The job was removed by the employer',
      'This requisition is no longer accepting applicants',
      'Sorry, the position has been closed.',
      'The application deadline has passed',
      "We're no longer hiring for this role",
      'This opportunity is closed',
      'This opportunity has closed and is no longer accepting applications',
    ];

    for (const phrase of closedPhrases) {
      it(`detects closed: "${phrase.slice(0, 50)}..."`, () => {
        const result = analyzeSignals(makePage({ text: phrase }));
        assert.equal(result.jobClosed, true);
        assert.ok(result.closedReason, 'should include closedReason');
      });
    }

    it('does not flag normal job listing text', () => {
      const text = 'We are hiring a Senior Engineer. Apply now to join our team!';
      const result = analyzeSignals(makePage({ text }));
      assert.equal(result.jobClosed, false);
      assert.equal(result.closedReason, null);
    });

    it('does not flag partial matches', () => {
      const text = 'This position is currently accepting applications.';
      const result = analyzeSignals(makePage({ text }));
      assert.equal(result.jobClosed, false);
    });

    it('is case-insensitive', () => {
      const text = 'THIS JOB IS CLOSED';
      const result = analyzeSignals(makePage({ text }));
      assert.equal(result.jobClosed, true);
    });
  });

  // ── Job Closed Detection (JSON-LD validThrough) ───────────────────

  describe('JSON-LD job closed detection', () => {
    it('detects expired validThrough date', () => {
      const result = analyzeSignals(makePage({
        jsonLd: [{
          '@type': 'JobPosting',
          validThrough: '2020-01-01T00:00:00Z',
        }],
      }));
      assert.equal(result.jobClosed, true);
      assert.ok(result.closedReason.includes('validThrough'));
    });

    it('does not flag future validThrough date', () => {
      const future = new Date(Date.now() + 86400000 * 30).toISOString();
      const result = analyzeSignals(makePage({
        jsonLd: [{
          '@type': 'JobPosting',
          validThrough: future,
        }],
      }));
      assert.equal(result.jobClosed, false);
    });

    it('ignores non-JobPosting JSON-LD types', () => {
      const result = analyzeSignals(makePage({
        jsonLd: [{
          '@type': 'Organization',
          validThrough: '2020-01-01T00:00:00Z',
        }],
      }));
      assert.equal(result.jobClosed, false);
    });

    it('text pattern takes priority over JSON-LD', () => {
      const result = analyzeSignals(makePage({
        text: 'This job is closed',
        jsonLd: [{
          '@type': 'JobPosting',
          validThrough: '2020-01-01T00:00:00Z',
        }],
      }));
      assert.equal(result.jobClosed, true);
      // Reason should be from text pattern, not JSON-LD
      assert.ok(!result.closedReason.includes('validThrough'));
    });

    it('handles JobPosting without validThrough', () => {
      const result = analyzeSignals(makePage({
        jsonLd: [{ '@type': 'JobPosting', title: 'Engineer' }],
      }));
      assert.equal(result.jobClosed, false);
    });
  });

  // ── Login Wall Detection ──────────────────────────────────────────

  describe('login wall detection', () => {
    it('detects login wall with password field and login text', () => {
      const result = analyzeSignals(makePage({
        text: 'Please sign in to continue',
        hasPasswordField: true,
      }));
      assert.ok(result.requires.includes('login'));
    });

    it('does not flag login without password field', () => {
      const result = analyzeSignals(makePage({
        text: 'Please sign in to continue',
        hasPasswordField: false,
      }));
      assert.ok(!result.requires.includes('login'));
    });

    it('does not flag password field without login text', () => {
      const result = analyzeSignals(makePage({
        text: 'Enter your password to unlock this document',
        hasPasswordField: true,
      }));
      assert.ok(!result.requires.includes('login'));
    });

    const loginPhrases = [
      'Sign in to continue',
      'Log in to view this page',
      'Please sign in',
      'Please log in to apply',
      'Create an account to get started',
      'Authentication required',
    ];

    for (const phrase of loginPhrases) {
      it(`detects login: "${phrase}"`, () => {
        const result = analyzeSignals(makePage({
          text: phrase,
          hasPasswordField: true,
        }));
        assert.ok(result.requires.includes('login'), `should detect: ${phrase}`);
      });
    }
  });

  // ── CAPTCHA Detection ─────────────────────────────────────────────

  describe('captcha detection', () => {
    it('adds captcha to requires when hasCaptcha is true', () => {
      const result = analyzeSignals(makePage({ hasCaptcha: true }));
      assert.ok(result.requires.includes('captcha'));
    });

    it('does not add captcha when hasCaptcha is false', () => {
      const result = analyzeSignals(makePage({ hasCaptcha: false }));
      assert.ok(!result.requires.includes('captcha'));
    });

    it('detects both login and captcha together', () => {
      const result = analyzeSignals(makePage({
        text: 'Please sign in to continue',
        hasPasswordField: true,
        hasCaptcha: true,
      }));
      assert.ok(result.requires.includes('login'));
      assert.ok(result.requires.includes('captcha'));
      assert.equal(result.requires.length, 2);
    });
  });

  // ── Return shape ──────────────────────────────────────────────────

  describe('return value shape', () => {
    it('returns expected structure for clean page', () => {
      const result = analyzeSignals(makePage());
      assert.deepEqual(result, {
        jobClosed: false,
        closedReason: null,
        requires: [],
      });
    });

    it('handles empty jsonLd array', () => {
      const result = analyzeSignals(makePage({ jsonLd: [] }));
      assert.equal(result.jobClosed, false);
    });

    it('handles undefined jsonLd gracefully', () => {
      const result = analyzeSignals(makePage({ jsonLd: undefined }));
      assert.equal(result.jobClosed, false);
    });
  });
});
