import { describe, expect, it } from 'vitest';

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
    mode: 'mask' as const,
    enabledPatterns: ['iban', 'germanId', 'email'],
    customPatterns: [],
  };

  it('masks IBAN in text', () => {
    const result = scrubPii('Transfer to DE89 3704 0044 0532 0130 00', config);
    expect(result.text).toContain('[IBAN]');
    expect(result.detectedTypes).toContain('iban');
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('masks German ID in text', () => {
    const result = scrubPii('My Personalausweis is T22000129', config);
    expect(result.text).toContain('[GERMAN_ID]');
    expect(result.detectedTypes).toContain('germanId');
  });

  it('throws in block mode when IBAN detected', () => {
    const blockConfig = { ...config, mode: 'block' as const };
    expect(() =>
      scrubPii('Transfer to DE89 3704 0044 0532 0130 00', blockConfig),
    ).toThrow('Message blocked');
  });

  it('throws in block mode when German ID detected', () => {
    const blockConfig = { ...config, mode: 'block' as const };
    expect(() => scrubPii('ID: T22000129', blockConfig)).toThrow(
      'Message blocked',
    );
  });

  it('passes through when disabled', () => {
    const disabledConfig = { ...config, enabled: false };
    const result = scrubPii('DE89 3704 0044 0532 0130 00', disabledConfig);
    expect(result.text).toContain('DE89');
    expect(result.matchCount).toBe(0);
  });
});
