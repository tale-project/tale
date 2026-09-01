import { describe, expect, it } from 'vitest';

import {
  isNormalizedAuthEmail,
  normalizeAuthEmail,
} from './normalize_auth_email';

describe('normalizeAuthEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeAuthEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeAuthEmail('a@B.com');
    expect(normalizeAuthEmail(once)).toBe(once);
  });

  it('detects normalized form', () => {
    expect(isNormalizedAuthEmail('user@example.com')).toBe(true);
    expect(isNormalizedAuthEmail('User@Example.com')).toBe(false);
  });
});
