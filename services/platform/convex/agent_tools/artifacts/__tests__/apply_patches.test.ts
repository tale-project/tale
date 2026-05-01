import { describe, expect, it } from 'vitest';

import { applyPatches, applySinglePatch } from '../apply_patches';

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
});
