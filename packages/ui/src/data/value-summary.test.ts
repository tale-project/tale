import { describe, expect, it } from 'vitest';

import {
  kindOf,
  SUMMARY_ITEMS,
  SUMMARY_KEY_NAMES,
  SUMMARY_TEXT_LENGTH,
  summaryOf,
} from './value-summary';

describe('kindOf', () => {
  it.each([
    ['text', 'string'],
    [3, 'number'],
    [Number.NaN, 'number'],
    [true, 'boolean'],
    [null, 'null'],
    [undefined, 'undefined'],
    [[1], 'array'],
    [{ a: 1 }, 'object'],
  ] as const)('reads %j as %s', (value, kind) => {
    expect(kindOf(value)).toBe(kind);
  });

  it('reads a bigint as a number', () => {
    expect(kindOf(5n)).toBe('number');
  });
});

describe('summaryOf', () => {
  it('keeps a short string whole, with its length and size', () => {
    expect(summaryOf('Invoice 42')).toEqual({
      kind: 'string',
      text: 'Invoice 42',
      length: 10,
      bytes: 12,
    });
  });

  it('cuts a long string and says so', () => {
    const text = 'x'.repeat(SUMMARY_TEXT_LENGTH + 20);
    const summary = summaryOf(text);
    expect(summary.text).toHaveLength(SUMMARY_TEXT_LENGTH);
    expect(summary).toMatchObject({ cut: true, length: text.length });
  });

  it('never splits a character that takes two units', () => {
    const text = `${'a'.repeat(SUMMARY_TEXT_LENGTH - 1)}😀tail`;
    const summary = summaryOf(text);
    expect(summary.text).toBe('a'.repeat(SUMMARY_TEXT_LENGTH - 1));
    expect(summary.cut).toBe(true);
  });

  it('writes numbers, NaN and Infinity and booleans as text', () => {
    expect(summaryOf(1.5)).toMatchObject({ kind: 'number', text: '1.5' });
    expect(summaryOf(Number.NaN)).toMatchObject({
      kind: 'number',
      text: 'NaN',
    });
    expect(summaryOf(Infinity)).toMatchObject({ text: 'Infinity' });
    expect(summaryOf(false)).toMatchObject({ kind: 'boolean', text: 'false' });
  });

  it('counts an object’s keys and names the first few', () => {
    const value = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`k${index}`, index]),
    );
    const summary = summaryOf(value);
    expect(summary.keys).toBe(12);
    expect(summary.names).toHaveLength(SUMMARY_KEY_NAMES);
    expect(summary.names?.[0]).toBe('k0');
  });

  it('gives a list’s length and its first items one level deep', () => {
    const summary = summaryOf([{ a: 1 }, [1, 2], 'three', 4, 5]);
    expect(summary.length).toBe(5);
    expect(summary.items).toHaveLength(SUMMARY_ITEMS);
    expect(summary.items).toEqual([
      { kind: 'object', keys: 1, names: ['a'] },
      { kind: 'array', length: 2 },
      { kind: 'string', text: 'three', length: 5 },
    ]);
  });

  it('measures the size as UTF-8 JSON and leaves undefined without one', () => {
    expect(summaryOf({ é: 'ü' }).bytes).toBe(
      new TextEncoder().encode('{"é":"ü"}').length,
    );
    expect(summaryOf(undefined)).toEqual({ kind: 'undefined' });
  });
});
