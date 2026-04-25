import { describe, expect, it } from 'vitest';

import type { PiiConfig } from '../index';
import { scrubPii } from '../index';
import { detectPii } from '../pii_detector';
import { maskPii } from '../pii_masker';
import { BUILT_IN_PII_PATTERNS, getEnabledPatterns } from '../pii_patterns';

describe('BUILT_IN_PII_PATTERNS', () => {
  it('includes all expected pattern names', () => {
    const names = BUILT_IN_PII_PATTERNS.map((p) => p.name);
    expect(names).toContain('email');
    expect(names).toContain('phone');
    expect(names).toContain('ssn');
    expect(names).toContain('creditCard');
    expect(names).toContain('ipAddress');
    expect(names).toContain('dateOfBirth');
    expect(names).toContain('address');
    expect(names).toContain('iban');
    expect(names).toContain('germanId');
  });
});

describe('getEnabledPatterns', () => {
  it('filters patterns by name', () => {
    const enabled = getEnabledPatterns(['email', 'iban']);
    expect(enabled).toHaveLength(2);
    expect(enabled.map((p) => p.name)).toEqual(['email', 'iban']);
  });

  it('returns empty array for unknown names', () => {
    const enabled = getEnabledPatterns(['nonexistent']);
    expect(enabled).toHaveLength(0);
  });

  it('includes new patterns when requested', () => {
    const enabled = getEnabledPatterns(['iban', 'germanId']);
    expect(enabled).toHaveLength(2);
    expect(enabled[0].name).toBe('iban');
    expect(enabled[1].name).toBe('germanId');
  });
});

describe('IBAN pattern', () => {
  const ibanPatterns = getEnabledPatterns(['iban']);

  it('detects German IBAN', () => {
    const matches = detectPii(
      'My IBAN is DE89 3704 0044 0532 0130 00',
      ibanPatterns,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe('iban');
  });

  it('detects Swiss IBAN', () => {
    const matches = detectPii('CH93 0076 2011 6238 5295 7', ibanPatterns);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe('iban');
  });

  it('detects French IBAN', () => {
    const matches = detectPii(
      'FR76 3000 6000 0112 3456 7890 189',
      ibanPatterns,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe('iban');
  });

  it('detects UK IBAN', () => {
    const matches = detectPii('GB29 NWBK 6016 1331 9268 19', ibanPatterns);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe('iban');
  });

  it('detects IBAN without spaces', () => {
    const matches = detectPii('DE89370400440532013000', ibanPatterns);
    expect(matches).toHaveLength(1);
  });

  it('does not match short random strings', () => {
    const matches = detectPii('AB12 is not an IBAN', ibanPatterns);
    expect(matches).toHaveLength(0);
  });

  it('masks IBAN with [IBAN] placeholder', () => {
    const text = 'Send to DE89 3704 0044 0532 0130 00 please';
    const matches = detectPii(text, ibanPatterns);
    const masked = maskPii(text, matches);
    expect(masked).toContain('[IBAN]');
    expect(masked).not.toContain('DE89');
  });
});

describe('German ID pattern', () => {
  const germanIdPatterns = getEnabledPatterns(['germanId']);

  it('detects valid German ID serial', () => {
    const matches = detectPii('ID: T22000129', germanIdPatterns);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe('germanId');
  });

  it('detects another valid German ID', () => {
    const matches = detectPii('My ID number is L0100FG57', germanIdPatterns);
    expect(matches).toHaveLength(1);
  });

  it('does not match digit-only strings like 123456789', () => {
    const matches = detectPii('Document: 123456789', germanIdPatterns);
    expect(matches).toHaveLength(0);
  });

  it('does not match lowercase strings', () => {
    const matches = detectPii('abcdefghi', germanIdPatterns);
    expect(matches).toHaveLength(0);
  });

  it('masks German ID with [GERMAN_ID] placeholder', () => {
    const text = 'Personalausweis: T22000129';
    const matches = detectPii(text, germanIdPatterns);
    const masked = maskPii(text, matches);
    expect(masked).toContain('[GERMAN_ID]');
    expect(masked).not.toContain('T22000129');
  });
});

describe('scrubPii with new patterns', () => {
  const config = {
    enabled: true,
    mode: 'mask',
    enabledPatterns: ['iban', 'germanId', 'email'],
    customPatterns: [],
  } satisfies PiiConfig;

  it('masks IBAN in text', () => {
    const result = scrubPii('Transfer to DE89 3704 0044 0532 0130 00', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toContain('[IBAN]');
    expect(result.categoryIds).toContain('iban');
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('masks German ID in text', () => {
    const result = scrubPii('My Personalausweis is T22000129', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toContain('[GERMAN_ID]');
    expect(result.categoryIds).toContain('germanId');
  });

  it('returns blocked in block mode when IBAN detected', () => {
    const blockConfig = { ...config, mode: 'block' } satisfies PiiConfig;
    const result = scrubPii(
      'Transfer to DE89 3704 0044 0532 0130 00',
      blockConfig,
    );
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.categoryIds).toContain('iban');
  });

  it('returns blocked in block mode when German ID detected', () => {
    const blockConfig = { ...config, mode: 'block' } satisfies PiiConfig;
    const result = scrubPii('ID: T22000129', blockConfig);
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.categoryIds).toContain('germanId');
  });

  it('passes through when disabled', () => {
    const disabledConfig = { ...config, enabled: false };
    const result = scrubPii('DE89 3704 0044 0532 0130 00', disabledConfig);
    expect(result.kind).toBe('pass');
  });
});

describe('overlap dedup (regression for #1618)', () => {
  // Before the dedup fix, the phone regex matched a 14-char prefix of a
  // creditCard match; both ranges shared a start, and maskPii spliced the
  // shorter replacement first using original indices into a mutated string,
  // eating adjacent characters — sometimes the next [EMAIL] token entirely.
  const config = {
    enabled: true,
    mode: 'mask',
    enabledPatterns: ['email', 'phone', 'creditCard'],
    customPatterns: [],
  } satisfies PiiConfig;

  it('does not eat the [EMAIL] token when CC + email are adjacent', () => {
    // The original repro from the issue: prior to the fix, the email part
    // disappeared completely from the output.
    const result = scrubPii('4532123456789010 test@example.com 123', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CREDIT_CARD] [EMAIL] 123');
  });

  it('keeps creditCard, drops the overlapping phone match', () => {
    const result = scrubPii('4532-1234-5678-9010', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CREDIT_CARD]');
    expect(result.text).not.toContain('[PHONE]');
    expect(result.categoryIds).toEqual(['creditCard']);
  });

  it('does not corrupt surrounding text when CC + email co-occur with prose', () => {
    const result = scrubPii(
      'My credit card is 4532-1234-5678-9010, my email is alice@example.com.',
      config,
    );
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe(
      'My credit card is [CREDIT_CARD], my email is [EMAIL].',
    );
  });

  it('masks all three independent items when patterns do not overlap', () => {
    const result = scrubPii(
      'call 555-867-5309 mail a@b.com card 4532-1234-5678-9010',
      config,
    );
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toContain('[PHONE]');
    expect(result.text).toContain('[EMAIL]');
    expect(result.text).toContain('[CREDIT_CARD]');
    expect(result.text).not.toMatch(/\d{3}-\d{3}-\d{4}/);
    expect(result.text).not.toMatch(/4532/);
  });

  it('handles email and creditCard separated only by a non-word char', () => {
    // The creditCard regex requires \b on both sides, so a letter-adjacent
    // CC (e.g. ".com4532...") won't match — that's an intentional limit of
    // the existing pattern. A non-word separator (here a comma) is enough.
    const result = scrubPii('test@example.com,4532-1234-5678-9010', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[EMAIL],[CREDIT_CARD]');
  });
});

describe('CVC pattern (context-anchored)', () => {
  const config = {
    enabled: true,
    mode: 'mask',
    enabledPatterns: ['cvc'],
    customPatterns: [],
  } satisfies PiiConfig;

  it('masks "my CVC is 123"', () => {
    const result = scrubPii('my CVC is 123', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('my [CVC]');
  });

  it('masks "cvv: 4567"', () => {
    const result = scrubPii('cvv: 4567', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CVC]');
  });

  it('masks "card security code 890"', () => {
    const result = scrubPii('card security code 890', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CVC]');
  });

  it('masks "card-security-code 100"', () => {
    const result = scrubPii('card-security-code 100', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CVC]');
  });

  it('masks "CV2=999" (mixed case via i flag)', () => {
    const result = scrubPii('CV2=999', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('[CVC]');
  });

  it('does NOT detect bare 3-digit numbers without context', () => {
    // Intentional: bare digits would false-positive on ages, room numbers,
    // error codes, etc. Industry-standard tools (Presidio, Comprehend, CF
    // WAF) skip CVV for the same reason.
    const result = scrubPii('My room is 123 and my age is 45.', config);
    expect(result.kind).toBe('pass');
  });

  it('does NOT match the literal word "cid" without a number', () => {
    const result = scrubPii('citric acid is sour', config);
    expect(result.kind).toBe('pass');
  });
});
