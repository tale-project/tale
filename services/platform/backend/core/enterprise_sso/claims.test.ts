import { describe, expect, it } from 'vitest';

import {
  claimValueToStrings,
  resolveClaimPath,
  sanitizeRawClaims,
} from './claims';

describe('resolveClaimPath (#1506)', () => {
  const claims = {
    email: 'user@example.com',
    realm_access: { roles: ['admin', 'user'] },
    nested: { deep: { value: 'x' } },
  };

  it('resolves top-level and nested dot-paths', () => {
    expect(resolveClaimPath(claims, 'email')).toBe('user@example.com');
    expect(resolveClaimPath(claims, 'realm_access.roles')).toEqual([
      'admin',
      'user',
    ]);
    expect(resolveClaimPath(claims, 'nested.deep.value')).toBe('x');
  });

  it('returns undefined for missing segments, empty paths and non-objects', () => {
    expect(resolveClaimPath(claims, 'missing')).toBeUndefined();
    expect(resolveClaimPath(claims, 'email.sub')).toBeUndefined();
    expect(resolveClaimPath(claims, '')).toBeUndefined();
    expect(resolveClaimPath(null, 'email')).toBeUndefined();
    expect(resolveClaimPath('string', 'email')).toBeUndefined();
  });
});

describe('claimValueToStrings (#1506)', () => {
  it('normalises strings, arrays and junk', () => {
    expect(claimValueToStrings('admin')).toEqual(['admin']);
    expect(claimValueToStrings('')).toEqual([]);
    expect(claimValueToStrings(['a', 1, 'b', null])).toEqual(['a', 'b']);
    expect(claimValueToStrings({ a: 1 })).toEqual([]);
    expect(claimValueToStrings(undefined)).toEqual([]);
  });
});

describe('sanitizeRawClaims (#1506)', () => {
  it('passes through claims with Convex-safe keys unchanged', () => {
    const claims = {
      email: 'user@example.com',
      'https://example.com/roles': ['admin'],
      realm_access: { roles: ['x'] },
    };
    expect(sanitizeRawClaims(claims)).toBe(claims);
    expect(sanitizeRawClaims(undefined)).toBeUndefined();
  });

  it('drops keys Convex cannot carry as record fields', () => {
    const sanitized = sanitizeRawClaims({
      email: 'user@example.com',
      _internal: 'x',
      $meta: 'y',
      gröups: ['a'],
    });
    expect(sanitized).toEqual({ email: 'user@example.com' });
  });
});
