/**
 * The email pattern masks a whole address: its local part (the part before
 * the `@`) in any alphabet, apostrophes included, and none of the text
 * around it.
 *
 * The local part used to be `[a-zA-Z0-9._%+-]+`, so a match began after the
 * last character outside that class: `john.o'brien@example.ie` came out as
 * `john.o'[EMAIL]` and `jörg.müller@example.com` as `jörg.mü[EMAIL]`, the
 * person's name left in the text the model receives (#4777). The frozen
 * corpus holds no such address, so `data-driven.test.ts` never saw one.
 *
 * The limits the pattern accepts are pinned here as well, because the
 * pattern file (`configs/platform/system/pii/patterns/email.yml`) and the
 * guardrails guide state them: a limit that stops holding fails until both
 * say so.
 */

import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES, createScrubber, pass } from '../../lib/pii';

const ALL_PATTERNS_MASK = createScrubber({
  mode: 'mask',
  patterns: {
    email: true,
    phone: true,
    creditCard: true,
    cvc: true,
    iban: true,
    ipAddress: true,
    macAddress: true,
    jwt: true,
    ssn: true,
    dateOfBirth: true,
    address: { locales: '*' },
    nationalId: { locales: '*' },
  },
});

/** The text a mask-mode scrub sends onward: the input itself on a pass. */
function masked(input: string): string {
  const outcome = ALL_PATTERNS_MASK.scrub(input);
  return outcome.kind === 'modified' ? outcome.text : input;
}

describe('email: the whole address is masked', () => {
  it.each([
    ["mail john.o'brien@example.ie today", 'mail [EMAIL] today'],
    ['mail john.o’brien@example.ie today', 'mail [EMAIL] today'],
    ['write to jörg.müller@example.com today', 'write to [EMAIL] today'],
    // Control: the ASCII dot-atom form was always masked whole.
    ['mail john.obrien@example.ie today', 'mail [EMAIL] today'],
  ])('%s', (input, expected) => {
    expect(masked(input)).toBe(expected);
  });

  it.each([
    'иван.петров@example.ru',
    // Ukrainian writes its apostrophe three ways.
    "мар'яна@example.ua",
    'мар’яна@example.ua',
    'марʼяна@example.ua',
    'γιώργος.παπαδόπουλος@example.gr',
    'محمد.علي@example.com',
    'דוד.כהן@example.co.il',
    'राम.शर्मा@example.in',
    '김철수@example.kr',
    'nguyễn.văn.an@example.vn',
  ])('masks the local part %s', (address) => {
    expect(masked(`write to ${address} today`)).toBe('write to [EMAIL] today');
  });
});

describe('email: the text around an address stays', () => {
  it.each([
    // Scripts written without spaces between words run straight into an
    // address; the frozen ja and zh-Hans corpus records this shape.
    [
      'お客様はmarylee@company.ioにお住まいです。',
      'お客様は[EMAIL]にお住まいです。',
    ],
    ['请将包裹寄送至alex.smith@example.com。', '请将包裹寄送至[EMAIL]。'],
    // The prolonged sound mark that ends many katakana words is shared by
    // hiragana and katakana, not owned by either script.
    ['ユーザーadmin@example.jp', 'ユーザー[EMAIL]'],
    ['ติดต่อsomchai@example.co.th', 'ติดต่อ[EMAIL]'],
    // An apostrophe in front of an address is a quote, not part of it.
    ["send 'john@example.com' the file", "send '[EMAIL]' the file"],
    ['<john@example.com>', '<[EMAIL]>'],
    ['?email=john@example.com&lang=en', '?email=[EMAIL]&lang=en'],
  ])('%s', (input, expected) => {
    expect(masked(input)).toBe(expected);
  });
});

describe('email: accepted limits', () => {
  it('masks a local part only after a special such as =', () => {
    // RFC 5322 allows ! # $ & * / = ? ^ ` { | } ~ in a local part, but they
    // also delimit query strings, paths and markup: reading across them
    // would swallow the `email=` above.
    expect(masked('list+john=example.org@lists.example.com')).toBe(
      'list+john=[EMAIL]',
    );
  });

  it('does not read letters of a script written without spaces as part of an address', () => {
    expect(masked('山田@example.jp')).toBe('山田@example.jp');
    expect(masked('山田.taro@example.jp')).toBe('山田[EMAIL]');
  });

  it('does not detect a quoted local part or a domain in Unicode form', () => {
    expect(masked('"john doe"@example.com')).toBe('"john doe"@example.com');
    expect(masked('jörg@müller.de')).toBe('jörg@müller.de');
  });

  it('reads a local part at most 64 characters back from the @', () => {
    // RFC 5321's limit. A longer run is no address, but its last 64
    // characters and the domain still go.
    expect(masked(`${'ö'.repeat(70)}.ada@example.com`)).toBe(
      `${'ö'.repeat(10)}[EMAIL]`,
    );
  });
});

describe('email: scan time', () => {
  const emailOnly = createScrubber({ mode: 'mask', patterns: { email: true } });

  // A match is tried at every position of a run of local-part characters;
  // the 64-character bound keeps each try short, so a word as long as the
  // input clamp costs a linear scan, not a quadratic one. Generous bound —
  // this catches catastrophic backtracking, not a perf budget.
  it.each([
    ['an ASCII word', 'x'.repeat(MAX_MESSAGE_BYTES)],
    [
      'a word in Latin letters with diacritics',
      'ö'.repeat(MAX_MESSAGE_BYTES / 2),
    ],
    ['a Devanagari word', 'क'.repeat(Math.floor(MAX_MESSAGE_BYTES / 3))],
    ['a word broken by apostrophes', "a'".repeat(MAX_MESSAGE_BYTES / 2)],
  ])('scans %s in bounded time', (_, word) => {
    const start = performance.now();
    expect(emailOnly.scrub(word)).toEqual(pass());
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
