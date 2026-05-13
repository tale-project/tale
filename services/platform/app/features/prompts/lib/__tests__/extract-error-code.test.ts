import { describe, expect, it } from 'vitest';

import { extractErrorCode } from '../extract-error-code';

describe('extractErrorCode', () => {
  it('returns null for null / undefined / primitives', () => {
    expect(extractErrorCode(null)).toBeNull();
    expect(extractErrorCode(undefined)).toBeNull();
    expect(extractErrorCode('boom')).toBeNull();
    expect(extractErrorCode(42)).toBeNull();
    expect(extractErrorCode(true)).toBeNull();
  });

  it('returns code from ConvexError-shaped object', () => {
    const err = { data: { code: 'version_conflict' } };
    expect(extractErrorCode(err)).toBe('version_conflict');
  });

  it('returns code for forbidden / not_found / too_large / empty_content', () => {
    expect(extractErrorCode({ data: { code: 'forbidden' } })).toBe('forbidden');
    expect(extractErrorCode({ data: { code: 'not_found' } })).toBe('not_found');
    expect(extractErrorCode({ data: { code: 'too_large' } })).toBe('too_large');
    expect(extractErrorCode({ data: { code: 'empty_content' } })).toBe(
      'empty_content',
    );
  });

  it('normalizes RateLimitExceededError into rate_limited', () => {
    const err = new Error('Rate limit exceeded for org_1');
    expect(extractErrorCode(err)).toBe('rate_limited');
  });

  it('returns null when code is non-string', () => {
    expect(extractErrorCode({ data: { code: 42 } })).toBeNull();
    expect(extractErrorCode({ data: { code: null } })).toBeNull();
  });

  it('returns null when data is missing or not an object', () => {
    expect(extractErrorCode({})).toBeNull();
    expect(extractErrorCode({ data: null })).toBeNull();
    expect(extractErrorCode({ data: 'foo' })).toBeNull();
  });

  it('returns null when code key is absent', () => {
    expect(extractErrorCode({ data: { other: 'x' } })).toBeNull();
  });
});
