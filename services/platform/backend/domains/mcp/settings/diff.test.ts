import { describe, expect, it } from 'vitest';

import { diffConfigs } from './diff';

describe('what a change replaces', () => {
  it('lists each member that differs, before and after, in key order', () => {
    expect(
      diffConfigs(
        { minLength: 8, rules: { digits: true, symbols: false }, keep: 1 },
        { minLength: 12, rules: { digits: true, symbols: true }, keep: 1 },
      ),
    ).toEqual({
      diff: [
        { path: '/minLength', before: 8, after: 12 },
        { path: '/rules/symbols', before: false, after: true },
      ],
      truncated: false,
    });
  });

  it('leaves out the side a member is missing from', () => {
    expect(diffConfigs({ a: 1 }, { b: 2 }).diff).toEqual([
      { path: '/a', before: 1 },
      { path: '/b', after: 2 },
    ]);
  });

  it('compares a list whole, and escapes a member name in its pointer', () => {
    expect(diffConfigs({ 'a/b': [1, 2] }, { 'a/b': [1, 3] }).diff).toEqual([
      { path: '/a~1b', before: [1, 2], after: [1, 3] },
    ]);
  });

  it('answers nothing for equal configs, whatever their key order', () => {
    expect(
      diffConfigs({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }),
    ).toEqual({ diff: [], truncated: false });
  });

  it('replaces a removed resource whole', () => {
    expect(diffConfigs({ a: 1 }, null).diff).toEqual([
      { path: '', before: { a: 1 }, after: null },
    ]);
  });

  it('lists at most 200 members and says when it cut', () => {
    const wide = (value: number) =>
      Object.fromEntries(
        Array.from({ length: 250 }, (_, index) => [`k${index}`, value]),
      );
    const { diff, truncated } = diffConfigs(wide(1), wide(2));
    expect(diff).toHaveLength(200);
    expect(truncated).toBe(true);
  });
});
