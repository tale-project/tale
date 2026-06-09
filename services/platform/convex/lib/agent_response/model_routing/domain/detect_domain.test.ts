import { describe, expect, it } from 'vitest';

import { detectDomain } from './detect_domain';

describe('detectDomain', () => {
  it('classifies the obvious domains', () => {
    expect(
      detectDomain('Refactor this async function and fix the stack trace')
        .domain,
    ).toBe('code');
    expect(
      detectDomain('Solve for x in this integral equation, show the proof')
        .domain,
    ).toBe('math');
    expect(detectDomain('Translate this paragraph into French').domain).toBe(
      'translation',
    );
    expect(
      detectDomain('Summarize the key points of this report, tldr').domain,
    ).toBe('summary');
    expect(
      detectDomain('Review this contract clause for GDPR compliance liability')
        .domain,
    ).toBe('legal');
    expect(
      detectDomain('What dosage and prescription treats this symptom?').domain,
    ).toBe('medical');
    expect(
      detectDomain(
        'Estimate the portfolio valuation from this balance sheet and cash flow',
      ).domain,
    ).toBe('financial');
  });

  it('falls back to general for greetings / low-signal input', () => {
    expect(detectDomain('hello there').domain).toBe('general');
    expect(detectDomain('').domain).toBe('general');
    expect(detectDomain('   ').confidence).toBe(0);
  });

  it('respects word boundaries (no substring false positives)', () => {
    // "classify" should not trip the code keyword "class".
    const r = detectDomain('Please classify these animals by habitat');
    expect(r.domain).not.toBe('code');
  });

  it('returns a normalized confidence in [0,1]', () => {
    const r = detectDomain('debug this python api endpoint exception');
    expect(r.domain).toBe('code');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('does not let bare Latin tokens in CJK/Thai lexicons match inside English words', () => {
    // Regression: substring-mode (CJK/Thai) lexicons embed bare ASCII tokens
    // like "def"/"git"; without ASCII word boundaries those matched inside
    // ordinary English words ("def" in "definition", "git" in "legitimate"),
    // misrouting the turn to `code`. Word boundaries must stop that.
    const r = detectDomain(
      'The definition is clear and the arrangement is legitimate.',
    );
    expect(r.domain).not.toBe('code');
  });
});
