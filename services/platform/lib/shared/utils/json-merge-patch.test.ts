import { describe, expect, it } from 'vitest';

import { applyJsonMergePatch } from './json-merge-patch';

/**
 * RFC 7396 as the CRM `metadata` fields apply it on PATCH. The cases are
 * the RFC's own appendix A test cases (those whose target and patch are
 * objects — the field is always an object or unset), plus the three
 * behaviours the door relies on: an unset target, no mutation, and a
 * `__proto__` key landing as data rather than as the prototype.
 */

describe('applyJsonMergePatch', () => {
  it.each([
    [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
    [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
    [{ a: 'b' }, { a: null }, {}],
    [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
    [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
    [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
    [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
    [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])('RFC 7396: %j + %j → %j', (target, patch, expected) => {
    expect(applyJsonMergePatch(target, patch)).toEqual(expected);
  });

  it('merges into an empty object when nothing was stored yet', () => {
    expect(applyJsonMergePatch(null, { a: 1, gone: null })).toEqual({ a: 1 });
  });

  it('replaces a scalar or an array with an object rather than merging into it', () => {
    expect(applyJsonMergePatch({ a: 1 }, { a: { b: 2 } })).toEqual({
      a: { b: 2 },
    });
    expect(applyJsonMergePatch({ a: [1, 2] }, { a: { b: 2 } })).toEqual({
      a: { b: 2 },
    });
  });

  it('mutates neither argument', () => {
    const target = { a: { b: 'c' }, keep: true };
    const patch = { a: { b: 'd' }, keep: null };
    const merged = applyJsonMergePatch(target, patch);
    expect(merged).toEqual({ a: { b: 'd' } });
    expect(target).toEqual({ a: { b: 'c' }, keep: true });
    expect(patch).toEqual({ a: { b: 'd' }, keep: null });
  });

  it('stores a __proto__ key as data and leaves the prototype alone', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}}') as Record<
      string,
      unknown
    >;
    const merged = applyJsonMergePatch({ a: 1 }, patch);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, '__proto__')).toBe(true);
    // Serialised as data — the key a client stored is the key it reads back.
    expect(JSON.stringify(merged)).toBe(
      '{"a":1,"__proto__":{"polluted":true}}',
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
