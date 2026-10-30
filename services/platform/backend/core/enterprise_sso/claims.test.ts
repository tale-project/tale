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

  it('reads a claim whose name contains dots as written (#4775)', () => {
    const namespaced = {
      'https://tale.example.com/roles': ['admin'],
      'urn:oid:1.3.6.1.4.1.5923.1.1.1.1': 'staff',
    };
    expect(
      resolveClaimPath(namespaced, 'https://tale.example.com/roles'),
    ).toEqual(['admin']);
    expect(
      resolveClaimPath(namespaced, 'urn:oid:1.3.6.1.4.1.5923.1.1.1.1'),
    ).toBe('staff');
  });

  it('prefers the name as written over the dot-path walk (#4775)', () => {
    expect(
      resolveClaimPath({ 'a.b': 'exact', a: { b: 'nested' } }, 'a.b'),
    ).toBe('exact');
  });

  it('walks into a claim object whose name contains dots (#4775)', () => {
    const namespacedObject = {
      'https://tale.example.com/claims': { roles: ['admin'] },
    };
    expect(
      resolveClaimPath(
        namespacedObject,
        'https://tale.example.com/claims.roles',
      ),
    ).toEqual(['admin']);
  });

  it('falls back to shorter names when a longer one leads nowhere (#4775)', () => {
    const overlapping = { 'a.b': { other: 1 }, a: { b: { c: 'found' } } };
    expect(resolveClaimPath(overlapping, 'a.b.c')).toBe('found');
    expect(resolveClaimPath(overlapping, 'a.b.missing')).toBeUndefined();
  });

  it('reads only the claims themselves, never inherited properties (#4775)', () => {
    expect(resolveClaimPath({}, 'constructor')).toBeUndefined();
    expect(resolveClaimPath({}, '__proto__')).toBeUndefined();
    expect(resolveClaimPath(claims, 'nested.toString')).toBeUndefined();
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
