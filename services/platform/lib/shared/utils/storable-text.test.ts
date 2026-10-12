import { describe, expect, it } from 'vitest';

import {
  cutText,
  reportText,
  storableJson,
  storableText,
  unstorableTextProblem,
  unstorableTexts,
} from './storable-text';

describe('cutText', () => {
  it('never splits a character that takes two', () => {
    expect(cutText('ab😀', 3)).toBe('ab');
    expect(cutText('ab😀', 4)).toBe('ab😀');
    expect(cutText('abc', 2)).toBe('ab');
    expect(cutText('abc', 9)).toBe('abc');
  });
});

describe('reportText', () => {
  it('cuts text the one way, to whatever length a report keeps of it', () => {
    expect(reportText('short')).toBe('short');
    expect(reportText('y'.repeat(5000), 4096)).toBe(`${'y'.repeat(4096)}…`);
    expect(reportText(`${'a'.repeat(4095)}😀`, 4096)).toBe(
      `${'a'.repeat(4095)}…`,
    );
    expect(reportText('a\u0000b', 4096)).toBe('a�b');
  });
});

describe('storableText', () => {
  it('replaces what jsonb refuses and keeps everything else', () => {
    expect(storableText('half \ud83d here')).toBe('half � here');
    expect(storableText('nul \u0000 here')).toBe('nul � here');
    expect(storableText('whole 😀 and ü')).toBe('whole 😀 and ü');
  });
});

describe('storableJson', () => {
  it('fixes strings and member names at any depth', () => {
    expect(
      storableJson({ a: ['ok', { 'k\u0000': 'x\ud800' }], n: 1, b: true }),
    ).toEqual({ a: ['ok', { 'k�': 'x�' }], n: 1, b: true });
  });

  it('returns a value that needs nothing as it is', () => {
    const value = { a: ['ok', { b: 'fine 😀' }], n: null };
    expect(storableJson(value)).toBe(value);
  });

  it('keeps a member named __proto__ as data', () => {
    const value = JSON.parse('{"__proto__": "\\u0000"}') as Record<
      string,
      unknown
    >;
    const fixed = storableJson(value);
    expect(Object.getPrototypeOf(fixed)).toBe(Object.prototype);
    expect(Object.hasOwn(fixed, '__proto__')).toBe(true);
    expect(fixed.__proto__).toBe('�');
  });
});

describe('unstorableTexts', () => {
  it('names every text Postgres could not store, a member name included, by its pointer', () => {
    expect(unstorableTextProblem('fine 😀')).toBeNull();
    expect(
      unstorableTexts({
        a: 'nul \u0000',
        'b/c\u0000': 1,
        list: ['ok', 'half \ud83d'],
        both: '\ud800 and \u0000',
      }),
    ).toEqual([
      { pointer: '/a', problem: unstorableTextProblem('\u0000') },
      { pointer: '/b~1c\u0000', problem: unstorableTextProblem('\u0000') },
      { pointer: '/list/1', problem: unstorableTextProblem('\ud800') },
      // A NUL is named first, as the REST door names it.
      { pointer: '/both', problem: unstorableTextProblem('\u0000') },
    ]);
    expect(unstorableTexts({ fine: ['ok', 1, null, true] })).toEqual([]);
  });
});
