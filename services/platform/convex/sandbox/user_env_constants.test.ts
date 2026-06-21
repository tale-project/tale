import { describe, expect, it } from 'vitest';

import {
  hasInteriorWhitespace,
  maskSecretPreview,
  MAX_ENV_KEY_LEN,
  MAX_ENV_VALUE_LEN,
  SECRET_MASK,
  validateEnvKey,
  validateEnvValue,
} from './user_env_constants';

describe('validateEnvKey', () => {
  it('accepts valid env var names', () => {
    for (const k of [
      'FOO',
      '_x',
      'API_KEY',
      'a1_b2',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]) {
      expect(validateEnvKey(k).ok).toBe(true);
    }
  });

  it('rejects empty, digit-leading, hyphen/space, and over-long keys', () => {
    expect(validateEnvKey('').ok).toBe(false);
    expect(validateEnvKey('1ABC').ok).toBe(false);
    expect(validateEnvKey('A-B').ok).toBe(false);
    expect(validateEnvKey('A B').ok).toBe(false);
    expect(validateEnvKey('a'.repeat(MAX_ENV_KEY_LEN + 1)).ok).toBe(false);
  });
});

describe('validateEnvValue', () => {
  it('accepts values up to the cap and rejects beyond it', () => {
    expect(validateEnvValue('').ok).toBe(true);
    expect(validateEnvValue('x'.repeat(MAX_ENV_VALUE_LEN)).ok).toBe(true);
    expect(validateEnvValue('x'.repeat(MAX_ENV_VALUE_LEN + 1)).ok).toBe(false);
  });
});

describe('SECRET_MASK', () => {
  it('is a non-empty fixed mask (never the plaintext)', () => {
    expect(SECRET_MASK.length).toBeGreaterThan(0);
  });
});

describe('maskSecretPreview', () => {
  it('reveals the first/last 3 chars with a fixed-width masked middle', () => {
    expect(maskSecretPreview('sk-ant-oat01-abcDEFxyz')).toBe('sk-••••xyz');
    expect(maskSecretPreview('abcDEFGHIJ')).toBe('abc••••HIJ');
  });

  it('fully masks a secret too short to reveal safely (≥4 stay hidden)', () => {
    expect(maskSecretPreview('short')).toBe(SECRET_MASK);
    expect(maskSecretPreview('abcdefghi')).toBe(SECRET_MASK); // len 9 → <10
    expect(maskSecretPreview('')).toBe(SECRET_MASK);
  });

  it('never leaks the true length (middle mask is constant width)', () => {
    const a = maskSecretPreview('abcWWWWWWWWWWWWWWWWWWWWxyz');
    const b = maskSecretPreview('abcWWxyz0000000');
    expect(a).toBe('abc••••xyz');
    expect(b.startsWith('abc••••')).toBe(true);
  });
});

describe('hasInteriorWhitespace', () => {
  it('is false for clean single-line values (leading/trailing space ignored)', () => {
    expect(hasInteriorWhitespace('sk-ant-oat01-abcDEF_123')).toBe(false);
    expect(hasInteriorWhitespace('  sk-ant-oat01-abc  ')).toBe(false);
    expect(hasInteriorWhitespace('')).toBe(false);
  });

  it('is true for an interior space, tab, or newline (wrapped-paste artifact)', () => {
    expect(hasInteriorWhitespace('sk-ant-oat01-abc def')).toBe(true);
    expect(hasInteriorWhitespace('sk-ant\toat01')).toBe(true);
    // The exact failure mode: token wrapped across two terminal lines.
    expect(hasInteriorWhitespace('sk-ant-oat01-PC0Ia\n yW3M')).toBe(true);
  });
});
