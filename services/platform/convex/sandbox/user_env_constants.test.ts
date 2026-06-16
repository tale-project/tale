import { describe, expect, it } from 'vitest';

import {
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
