import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { initServiceI18n } from '../../../i18n/init-service';
import { uiMessages } from '../../../i18n/messages';
import {
  formatNumberExact,
  formatValueInline,
  pathText,
  summarizeValue,
  summaryWords,
} from './summarize';

let i18n: ReturnType<typeof initServiceI18n>;
beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

function tFor(locale: string): TFunction {
  return i18n.getFixedT(locale, 'valueTree');
}

const NBSP = ' ';

describe('summarizeValue', () => {
  it.each([
    ['en', [], 'an empty list'],
    ['en', [1], 'a list of 1 item'],
    ['en', [1, 2], 'a list of 2 items'],
    ['en', {}, 'an empty object'],
    ['en', { a: 1 }, 'an object with 1 field'],
    ['en', { a: 1, b: 2 }, 'an object with 2 fields'],
    ['en', 'Fix login', '"Fix login"'],
    ['en', 'x'.repeat(3412), 'a text of 3,412 characters'],
    ['en', true, 'true'],
    ['en', null, 'empty'],
    ['en', undefined, 'missing'],
    ['de', [1, 2], 'eine Liste mit 2 Elementen'],
    ['de', { a: 1 }, 'ein Objekt mit 1 Feld'],
    ['de', 'Fix login', '„Fix login“'],
    ['de', 'x'.repeat(3412), 'ein Text mit 3.412 Zeichen'],
    ['de', false, 'falsch'],
    ['de', null, 'leer'],
    ['fr', [], 'une liste vide'],
    ['fr', [1, 2], 'une liste de 2 éléments'],
    ['fr', { a: 1, b: 2 }, 'un objet avec 2 champs'],
    ['fr', 'Fix login', `«${NBSP}Fix login${NBSP}»`],
    ['fr', true, 'vrai'],
    ['fr', undefined, 'absent'],
  ] as const)('%s: %j reads "%s"', (locale, value, expected) => {
    expect(summarizeValue(tFor(locale), value, { locale })).toBe(expected);
  });

  it('quotes text up to maxChars and words it by its length past it', () => {
    const t = tFor('en');
    expect(summarizeValue(t, 'abcdef', { maxChars: 6 })).toBe('"abcdef"');
    expect(summarizeValue(t, 'abcdefg', { maxChars: 6 })).toBe(
      'a text of 7 characters',
    );
  });
});

describe('formatValueInline', () => {
  it('cuts long text with an ellipsis instead of counting it', () => {
    const t = tFor('en');
    expect(formatValueInline(t, 'abcdefgh', { maxChars: 4 })).toBe('"abcd…"');
    // A cut never splits a character written with two code units.
    expect(formatValueInline(t, 'abc😀def', { maxChars: 4 })).toBe('"abc…"');
  });

  it('writes numbers in the reader’s separators without rounding them', () => {
    expect(formatValueInline(tFor('en'), 1234567.125, { locale: 'en' })).toBe(
      '1,234,567.125',
    );
    expect(formatValueInline(tFor('de'), 12.34567, { locale: 'de' })).toBe(
      '12,34567',
    );
    expect(formatValueInline(tFor('en'), 2026, { locale: 'en' })).toBe('2026');
    expect(formatValueInline(tFor('en'), -0.5, { locale: 'en' })).toBe('-0.5');
  });

  it('words containers by their size', () => {
    expect(formatValueInline(tFor('en'), [1, 2, 3])).toBe('a list of 3 items');
  });
});

describe('formatNumberExact', () => {
  it('keeps every digit JavaScript writes, and its exponent', () => {
    expect(formatNumberExact(0.1 + 0.2, 'en')).toBe('0.30000000000000004');
    expect(formatNumberExact(12345678901234567000, 'en')).toBe(
      '12,345,678,901,234,567,000',
    );
    expect(formatNumberExact(1e21, 'en')).toBe('1e+21');
    expect(formatNumberExact(Number.NaN, 'en')).toBe('NaN');
    expect(formatNumberExact(-12345.5, 'de')).toBe('-12.345,5');
  });
});

describe('summaryWords', () => {
  it('words a recorded summary the way the value would read', () => {
    const t = tFor('en');
    expect(summaryWords(t, { kind: 'array', length: 12 })).toBe(
      'a list of 12 items',
    );
    expect(summaryWords(t, { kind: 'object', keys: 3, names: ['a'] })).toBe(
      'an object with 3 fields',
    );
    expect(summaryWords(t, { kind: 'string', text: 'ok', length: 2 })).toBe(
      '"ok"',
    );
    expect(
      summaryWords(t, {
        kind: 'string',
        text: 'x'.repeat(80),
        length: 900,
        cut: true,
      }),
    ).toBe('a text of 900 characters');
    expect(summaryWords(t, { kind: 'number', text: '1000' })).toBe('1000');
    expect(summaryWords(t, { kind: 'number', text: '12000' })).toBe('12,000');
    // A 64-bit id the summary kept as text is never rewritten.
    expect(summaryWords(t, { kind: 'number', text: '9007199254740993' })).toBe(
      '9007199254740993',
    );
    expect(summaryWords(t, { kind: 'boolean', text: 'false' })).toBe('false');
    expect(summaryWords(t, { kind: 'redacted' })).toBe('a hidden secret');
    expect(summaryWords(t, { kind: 'elided', bytes: 2048 })).toBe(
      '2 KB not kept',
    );
  });
});

describe('pathText', () => {
  it('writes a path the way an expression reads it', () => {
    expect(pathText(['issues', 0, 'title'])).toBe('issues[0].title');
    expect(pathText(['first name'])).toBe('["first name"]');
    expect(pathText([0, 'a'])).toBe('[0].a');
    expect(pathText([])).toBe('');
  });
});
