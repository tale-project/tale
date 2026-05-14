import { describe, expect, it } from 'vitest';

import {
  clampMessage,
  escapeRegExp,
  execWithBudget,
  MAX_MESSAGE_BYTES,
  REGEX_EXEC_BUDGET_MS,
} from './regex-safety';

describe('regex-safety.escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    const meta = '.+*?^${}()|[]\\';
    const escaped = escapeRegExp(meta);
    // Building a literal matcher from the escaped string must match the
    // original character sequence exactly, with no wildcard side effects.
    expect(new RegExp(escaped).test(meta)).toBe(true);
  });

  it('leaves plain words alone', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
  });
});

describe('regex-safety.clampMessage', () => {
  it('truncates oversized input and reports it', () => {
    const big = 'x'.repeat(MAX_MESSAGE_BYTES + 100);
    const out = clampMessage(big);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(MAX_MESSAGE_BYTES);
  });

  it('leaves small input untouched', () => {
    const out = clampMessage('hi');
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('hi');
  });

  it('does not split a 4-byte emoji code point', () => {
    // 😀 (U+1F600) encodes to 4 bytes in UTF-8. If maxBytes lands in the
    // middle of the sequence, the truncator must drop the whole code point.
    // The slow path is exercised when cap < text.length (UTF-16 units).
    const text = 'hi 😀 world hi 😀 world';
    const utf16Len = text.length;
    for (let cap = 3; cap < utf16Len; cap += 1) {
      const out = clampMessage(text, cap);
      const encoded = new TextEncoder().encode(out.text);
      expect(encoded.length).toBeLessThanOrEqual(cap);
      // Round-tripping through the decoder must yield the same string —
      // proves we never produced a half-encoded sequence.
      expect(new TextDecoder('utf-8', { fatal: true }).decode(encoded)).toBe(
        out.text,
      );
    }
  });

  it('does not split a CJK 3-byte sequence', () => {
    const text = '日本語のテスト日本語のテスト';
    const utf16Len = text.length;
    for (let cap = 1; cap < utf16Len; cap += 1) {
      const out = clampMessage(text, cap);
      const encoded = new TextEncoder().encode(out.text);
      expect(encoded.length).toBeLessThanOrEqual(cap);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(encoded)).toBe(
        out.text,
      );
    }
  });

  it('does not split a combining-mark sequence mid-code-point', () => {
    // Each code point here is 2 bytes; cap < text.length always exercises
    // the slow path and asserts we never end inside a multibyte sequence.
    const text = 'éáíóúéáíóú';
    const utf16Len = text.length;
    for (let cap = 1; cap < utf16Len; cap += 1) {
      const out = clampMessage(text, cap);
      const encoded = new TextEncoder().encode(out.text);
      expect(encoded.length).toBeLessThanOrEqual(cap);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(encoded)).toBe(
        out.text,
      );
    }
  });

  it('measures the cap in real UTF-8 bytes on the slow path', () => {
    const samples = [
      'café résumé naïve café résumé naïve',
      '日本語のテスト日本語のテスト',
      'mix 😀 of 漢字 and ascii mix 😀 of 漢字',
    ];
    for (const sample of samples) {
      const fullBytes = new TextEncoder().encode(sample).length;
      // Pick a cap below the UTF-16 unit count so the slow path runs, and
      // below the byte length so truncation must happen.
      const cap = Math.min(fullBytes - 1, sample.length - 1);
      const out = clampMessage(sample, cap);
      const encoded = new TextEncoder().encode(out.text);
      expect(encoded.length).toBeLessThanOrEqual(cap);
      expect(out.truncated).toBe(true);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(encoded)).toBe(
        out.text,
      );
    }
  });

  it('clamps a 30 KB 4-byte-emoji payload at a 20 KB cap', () => {
    // Regression guard for the bytes-vs-code-units confusion: 😀 is two
    // UTF-16 code units (4 UTF-8 bytes) per code point. A naïve
    // `text.length <= maxBytes` early-return would accept the full 30 KB
    // string under a 20 KB cap because the UTF-16 code-unit count
    // (15 000) is already < 20 000. The honest contract counts real
    // UTF-8 bytes and must truncate this input below the cap.
    const emojiCount = 7_500; // 7_500 * 4 bytes = 30 000 UTF-8 bytes
    const big = '😀'.repeat(emojiCount);
    const fullBytes = new TextEncoder().encode(big).length;
    expect(fullBytes).toBe(emojiCount * 4);

    const cap = 20_000;
    const out = clampMessage(big, cap);
    expect(out.truncated).toBe(true);

    const outBytes = new TextEncoder().encode(out.text).length;
    expect(outBytes).toBeLessThanOrEqual(cap);
    expect(outBytes).toBeLessThan(fullBytes);
    // Round-trips cleanly under a strict decoder — proves the boundary
    // walk never produced a half-encoded 4-byte tail.
    expect(
      new TextDecoder('utf-8', { fatal: true }).decode(
        new TextEncoder().encode(out.text),
      ),
    ).toBe(out.text);
  });
});

describe('regex-safety.execWithBudget', () => {
  it('requires the global flag', () => {
    expect(() => execWithBudget(/foo/, 'foo')).toThrow(
      /requires a regex with the g flag/,
    );
  });

  it('collects multiple matches from a greedy regex', () => {
    const matches = execWithBudget(/\d+/g, 'a1 b22 c333');
    expect(matches.map((m) => m.matchedText)).toEqual(['1', '22', '333']);
  });

  it('aborts the multi-match loop when the per-call budget elapses', () => {
    // Budget mitigates the N-matches-per-pattern case (many short matches
    // each taking N ms). Catastrophic backtracking INSIDE a single V8
    // exec call is not interruptible from user code — that's a separate
    // ReDoS vector addressed by Zod length caps + admin guidance.
    const bigHaystack = 'a '.repeat(200_000);
    const start = Date.now();
    const matches = execWithBudget(/a/g, bigHaystack, 10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(matches.length).toBeLessThan(200_000);
  });

  it('advances past zero-length matches', () => {
    // `^` alone matches with zero length; without the `lastIndex += 1`
    // guard this would infinite-loop.
    const matches = execWithBudget(/^/g, 'abc');
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('honours a non-default positive budget', () => {
    // A generous budget must not truncate; a 1 ms budget on the same input
    // must truncate. Both prove the parameter is wired through.
    const bigHaystack = 'a '.repeat(200_000);
    const generous = execWithBudget(/a/g, bigHaystack, 60_000);
    expect(generous.length).toBe(200_000);

    const tight = execWithBudget(/a/g, bigHaystack, 1);
    expect(tight.length).toBeLessThan(200_000);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
  ])('falls back to the default budget on %s input', (_label, bad) => {
    // Misconfig must not silently disable the defense. We can't directly
    // observe the budget value, but we can prove the loop terminates and
    // does not run for the entirety of an Infinity-sized budget.
    const bigHaystack = 'a '.repeat(200_000);
    const start = Date.now();
    const matches = execWithBudget(/a/g, bigHaystack, bad);
    const elapsed = Date.now() - start;
    // The default budget is 50 ms, so this must finish well under several
    // seconds even with a poison input.
    expect(elapsed).toBeLessThan(REGEX_EXEC_BUDGET_MS * 50);
    expect(matches.length).toBeLessThanOrEqual(200_000);
  });
});

describe('regex-safety.execWithBudget — ReDoS regression', () => {
  it('survives 50 KB worst-case separator input under the default budget', () => {
    // Pathological shape called out in the W2-3 audit: 50 KB of repeated
    // `"a- "` separators is the worst case for alternation-heavy patterns
    // (address compose, phone context). With a representative
    // alternation-with-optional-separator regex, the whole loop must
    // return well under 200 ms — wider than the 50 ms budget so a slow
    // CI runner doesn't flake.
    const haystack = 'a- '.repeat(17_000); // 17 000 * 3 = 51 000 chars
    expect(haystack.length).toBeGreaterThanOrEqual(50_000);

    // Inline representative regex — kept local so this test is
    // independent of the address pattern composer (owned by A6).
    const addressLike = /\b(?:[A-Za-z]+[- ]?)+\d{1,4}(?:[- ]?[A-Za-z0-9]+)*\b/g;

    const start = Date.now();
    const matches = execWithBudget(addressLike, haystack);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(200);
    // The defense returns whatever it collected — content doesn't
    // matter, only that the call returned within budget.
    expect(Array.isArray(matches)).toBe(true);
  });
});
