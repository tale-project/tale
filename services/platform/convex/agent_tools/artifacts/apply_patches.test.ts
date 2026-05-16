import { describe, expect, it } from 'vitest';

import { applyPatches, applySinglePatch } from './apply_patches';

describe('applySinglePatch', () => {
  it('replaces a unique exact match', () => {
    const result = applySinglePatch('hello world', {
      search: 'world',
      replace: 'there',
    });
    expect(result).toEqual({ ok: true, content: 'hello there' });
  });

  it('rejects when search has zero matches', () => {
    const result = applySinglePatch('hello world', {
      search: 'goodbye',
      replace: 'there',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('0 times');
  });

  it('rejects when search has multiple matches', () => {
    const result = applySinglePatch('foo foo foo', {
      search: 'foo',
      replace: 'bar',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('more than once');
  });

  it('rejects empty search', () => {
    const result = applySinglePatch('anything', {
      search: '',
      replace: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty');
  });

  it('preserves surrounding whitespace and newlines', () => {
    const content = 'line one\n  let x = 1;\nline three';
    const result = applySinglePatch(content, {
      search: '  let x = 1;',
      replace: '  let x = 42;',
    });
    expect(result).toEqual({
      ok: true,
      content: 'line one\n  let x = 42;\nline three',
    });
  });

  it('handles multi-line search blocks', () => {
    const content = 'function add(a, b) {\n  return a + b;\n}\n';
    const result = applySinglePatch(content, {
      search: 'function add(a, b) {\n  return a + b;\n}',
      replace: 'function add(a, b) {\n  return a + b + 1;\n}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('a + b + 1');
  });

  it('flags self-overlapping search as ambiguous (the "aa" in "aaa" case)', () => {
    const result = applySinglePatch('aaa', { search: 'aa', replace: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('more than once');
  });

  it('treats CRLF and LF as distinct (LF search misses CRLF content)', () => {
    const result = applySinglePatch('a\r\nb', { search: 'a\nb', replace: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('0 times');
  });

  it('deletes the matched range when replace is empty', () => {
    const result = applySinglePatch('hello, world', {
      search: ', world',
      replace: '',
    });
    expect(result).toEqual({ ok: true, content: 'hello' });
  });

  it('matches at the start of the content', () => {
    const result = applySinglePatch('start middle end', {
      search: 'start',
      replace: 'begin',
    });
    expect(result).toEqual({ ok: true, content: 'begin middle end' });
  });

  it('matches at the very end of the content', () => {
    const result = applySinglePatch('start middle end', {
      search: 'end',
      replace: 'finish',
    });
    expect(result).toEqual({ ok: true, content: 'start middle finish' });
  });
});

describe('applyPatches', () => {
  it('applies multiple patches sequentially', () => {
    const result = applyPatches('one two three', [
      { search: 'one', replace: '1' },
      { search: 'two', replace: '2' },
      { search: 'three', replace: '3' },
    ]);
    expect(result).toEqual({ ok: true, content: '1 2 3' });
  });

  it('lets a later patch match text introduced by an earlier patch', () => {
    const result = applyPatches('alpha', [
      { search: 'alpha', replace: 'beta' },
      { search: 'beta', replace: 'gamma' },
    ]);
    expect(result).toEqual({ ok: true, content: 'gamma' });
  });

  it('reports failedIndex on first failing patch', () => {
    const result = applyPatches('one two three', [
      { search: 'one', replace: '1' },
      { search: 'four', replace: '4' },
      { search: 'three', replace: '3' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedIndex).toBe(1);
      expect(result.error).toContain('0 times');
    }
  });

  it('returns content unchanged on empty patch list', () => {
    expect(applyPatches('hello', [])).toEqual({ ok: true, content: 'hello' });
  });

  it('rejects ambiguous patch even if a later one would disambiguate', () => {
    const result = applyPatches('foo foo', [{ search: 'foo', replace: 'bar' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedIndex).toBe(0);
  });

  it('does not re-scan a replacement that creates a new match', () => {
    // The first patch turns "a" into "aa". The second pass walks forward
    // from the post-replace cursor in `applyPatches`, but `applySinglePatch`
    // is invoked fresh for each patch — so matching "aa" against "aa" is
    // unique and should succeed.
    const result = applyPatches('a', [
      { search: 'a', replace: 'aa' },
      { search: 'aa', replace: 'b' },
    ]);
    expect(result).toEqual({ ok: true, content: 'b' });
  });
});
