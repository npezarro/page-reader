/**
 * Post-extraction signal analysis.
 * Detects job status, login walls, captchas, etc.
 */

const CLOSED_PATTERNS = [
  /no longer accepting/i,
  /position has been filled/i,
  /this job is closed/i,
  /this (role|position|job) (has been|is) (closed|filled|removed)/i,
  /no longer (available|open|posted)/i,
  /this posting has (expired|been removed)/i,
  /job (has|was) (expired|removed|closed|deleted)/i,
  /this requisition is no longer/i,
  /sorry.{0,30}(position|role|job).{0,30}(no longer|been filled|closed)/i,
  /application.{0,20}(closed|deadline.{0,10}passed)/i,
  /we('re| are) no longer hiring/i,
  /this opportunity (has|is) (closed|no longer)/i,
];

const LOGIN_PATTERNS = [
  /sign in to (continue|view|apply)/i,
  /log in to (continue|view|apply)/i,
  /please (sign|log) in/i,
  /create an account/i,
  /authentication required/i,
];

export function analyzeSignals(extracted) {
  const { text, hasPasswordField, hasCaptcha, jsonLd } = extracted;

  // Job closed detection
  let jobClosed = false;
  let closedReason = null;

  for (const pattern of CLOSED_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      jobClosed = true;
      closedReason = match[0];
      break;
    }
  }

  // Also check JSON-LD for job posting status
  if (!jobClosed && jsonLd) {
    for (const ld of jsonLd) {
      if (ld['@type'] === 'JobPosting') {
        if (ld.validThrough) {
          const expires = new Date(ld.validThrough);
          if (expires < new Date()) {
            jobClosed = true;
            closedReason = `JSON-LD validThrough expired: ${ld.validThrough}`;
          }
        }
        if (ld.jobLocationType === 'TELECOMMUTE' && ld.hiringOrganization?.name) {
          // This is just metadata, not a closed signal, but useful context
        }
      }
    }
  }

  // Login wall detection
  const requires = [];

  if (hasPasswordField) {
    for (const pattern of LOGIN_PATTERNS) {
      if (pattern.test(text)) {
        requires.push('login');
        break;
      }
    }
  }

  if (hasCaptcha) {
    requires.push('captcha');
  }

  return {
    jobClosed,
    closedReason,
    requires,
  };
}
