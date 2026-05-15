/**
 * Tokenizer round-trip tests.
 *
 * The tokenizer's contract: detect PII, replace each match with an
 * indexed token, restore originals on the way back. These tests pin
 * the three behaviours that matter for the platform's AI-round-trip
 * flow:
 *
 *   1. Distinct values get distinct indices (`[EMAIL_1]`, `[EMAIL_2]`).
 *   2. Repeated values share their first-assigned index.
 *   3. `detokenize` is a true inverse — tokenize then detokenize gives
 *      back the original text byte-for-byte (modulo NFC normalization).
 */

import { describe, expect, it } from 'vitest';

import type { PiiMatch } from '../core/types';
import { createScrubber } from './scrubber';
import { applyTokenization, createTokenizer } from './tokenizer';

const ALL_PATTERNS = {
  email: true,
  phone: true,
  creditCard: true,
  iban: true,
  cvc: true,
  address: { locales: '*' as const },
  nationalId: { locales: '*' as const },
};

describe('tokenizer', () => {
  const tok = createTokenizer({ mode: 'mask', patterns: ALL_PATTERNS });

  it('replaces a single email with a stable token', () => {
    const { text, mapping } = tok.tokenize('Mail me at alice@example.com.');
    expect(text).toBe('Mail me at [EMAIL_1].');
    expect(mapping).toEqual({
      '[EMAIL_1]': { value: 'alice@example.com', type: 'email', index: 1 },
    });
  });

  it('assigns sequential indices to distinct values of the same type', () => {
    const { text, mapping } = tok.tokenize(
      'Either alice@a.co or bob@b.co works.',
    );
    expect(text).toBe('Either [EMAIL_1] or [EMAIL_2] works.');
    expect(mapping['[EMAIL_1]']?.value).toBe('alice@a.co');
    expect(mapping['[EMAIL_2]']?.value).toBe('bob@b.co');
  });

  it('reuses the same token for repeated values', () => {
    const { text, mapping } = tok.tokenize(
      'Send to alice@a.co and CC alice@a.co.',
    );
    expect(text).toBe('Send to [EMAIL_1] and CC [EMAIL_1].');
    expect(Object.keys(mapping)).toHaveLength(1);
  });

  it('round-trips through an AI-style response', () => {
    const input = 'I am at alice@a.co and my IBAN is DE89370400440532013000.';
    const { text: tokenized, mapping } = tok.tokenize(input);
    // Simulate an AI response that references the tokens in a different order.
    const aiResponse = `I'll send confirmation to ${tokenized.includes('[EMAIL_1]') ? '[EMAIL_1]' : ''} for the [IBAN_1] payment.`;
    const restored = tok.detokenize(aiResponse, mapping);
    expect(restored).toContain('alice@a.co');
    expect(restored).toContain('DE89370400440532013000');
  });

  it('returns segments with original offsets for UI overlay rendering', () => {
    const { segments } = tok.tokenize('Mail alice@a.co please.');
    expect(segments).toHaveLength(1);
    const seg = segments[0];
    if (!seg) throw new Error('expected one segment');
    expect(seg.start).toBe(5);
    expect(seg.end).toBe(15);
    expect(seg.value).toBe('alice@a.co');
    expect(seg.token).toBe('[EMAIL_1]');
    expect(seg.type).toBe('email');
  });

  it('passes clean prose through unchanged', () => {
    const result = tok.tokenize('The conference room was full of engineers.');
    expect(result.text).toBe('The conference room was full of engineers.');
    expect(Object.keys(result.mapping)).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
  });

  it('detokenize tolerates tokens wrapped in markdown', () => {
    const { mapping } = tok.tokenize('Mail alice@a.co.');
    const restored = tok.detokenize(
      'Confirmation sent to **[EMAIL_1]**.',
      mapping,
    );
    expect(restored).toBe('Confirmation sent to **alice@a.co**.');
  });

  it('detokenize is a no-op when mapping is empty', () => {
    expect(tok.detokenize('no tokens here', {})).toBe('no tokens here');
  });

  // ---------------------------------------------------------------------
  // AI-round-trip edge cases. The audit flagged each of these as a real
  // shape of model output we must survive in production — the tokenizer
  // is the contract that turns "send to AI" round-trips into a safe,
  // restorable flow.
  // ---------------------------------------------------------------------

  it('detokenizes when the AI rewrites prose but keeps the token verbatim', () => {
    const { mapping } = tok.tokenize('Mail alice@a.co please.');
    // AI paraphrases freely but leaves the token unchanged.
    const aiReply = 'Of course — I will forward the message to [EMAIL_1] now.';
    expect(tok.detokenize(aiReply, mapping)).toBe(
      'Of course — I will forward the message to alice@a.co now.',
    );
  });

  it('leaves output unchanged for tokens the AI omits', () => {
    const { mapping } = tok.tokenize(
      'Mail alice@a.co or call DE89370400440532013000.',
    );
    // AI references only `[EMAIL_1]` — `[IBAN_1]` is dropped on the
    // floor. The result must still be a valid string, not throw.
    const aiReply = 'Sending to [EMAIL_1] only.';
    expect(tok.detokenize(aiReply, mapping)).toBe(
      'Sending to alice@a.co only.',
    );
  });

  it('leaves invented tokens that are not in the mapping untouched', () => {
    const { mapping } = tok.tokenize('Mail alice@a.co please.');
    // AI hallucinates `[EMAIL_5]` — no entry exists. Preserve verbatim.
    const aiReply = 'I will mail [EMAIL_1] and CC [EMAIL_5] for safety.';
    expect(tok.detokenize(aiReply, mapping)).toBe(
      'I will mail alice@a.co and CC [EMAIL_5] for safety.',
    );
  });

  it('documents current behaviour for literal `[EMAIL_1]` placeholders in user input', () => {
    // Pre-existing literal placeholders in user input are NOT escaped
    // before tokenization (they pass through `detectPii` untouched
    // because they don't match the email regex). When the AI later
    // produces `[EMAIL_1]` referring to the *real* email it found, the
    // detokenizer replaces both occurrences — the user-typed literal
    // and the AI's reference — with the original PII value.
    //
    // This is acceptable in practice (literal `[EMAIL_1]` in user
    // prose is vanishingly rare), but pin the behaviour here so a
    // future change to escape on entry is a deliberate decision rather
    // than a silent shift in a corner case.
    const { text, mapping } = tok.tokenize(
      'I will refer to my address as [EMAIL_1]. My real address is alice@a.co.',
    );
    // The literal `[EMAIL_1]` survives tokenization (the email regex
    // doesn't match it), and the real email becomes `[EMAIL_1]`. Both
    // share the same token shape.
    expect(text).toContain('[EMAIL_1]');
    // Detokenize substitutes both back to the real email — the literal
    // is "lost" to round-trip but the AI's reference still works.
    const restored = tok.detokenize(text, mapping);
    expect(restored).toContain('alice@a.co');
  });

  it('assigns the same token to the same email occurring twice', () => {
    const { text, mapping } = tok.tokenize(
      'CC alice@a.co. Also bcc alice@a.co.',
    );
    expect(text).toBe('CC [EMAIL_1]. Also bcc [EMAIL_1].');
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(mapping['[EMAIL_1]']?.value).toBe('alice@a.co');
  });

  it('handles many matches in a 10KB input within a sane time budget', () => {
    // Build a payload that intersperses unique emails through the text.
    // The previous O(n²) splice loop would balloon proportionally to
    // `match_count * input_length`; we just assert this finishes in a
    // small wall-clock budget to catch quadratic regressions.
    const filler = 'lorem ipsum dolor sit amet '.repeat(50); // ~1.3 KB
    const parts: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      parts.push(filler, `contact me at user${i}@example.com today.`);
    }
    const input = parts.join('\n'); // ~135 KB but the scrubber clamps.
    const start = Date.now();
    const { mapping, text } = tok.tokenize(input);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    // Verify the tokens actually replaced something so the test fails
    // loudly if pattern resolution silently broke.
    expect(text).toContain('[EMAIL_1]');
    expect(Object.keys(mapping).length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Unification + edge-case pins for W2-2 (tokenizer unification).
//
// The scrubber's `mode: 'tokenize'` path and the standalone tokenizer
// both go through `applyTokenization`. If a future refactor splits them
// apart, these tests fail loudly and the divergence is visible in CI.
// -----------------------------------------------------------------------

describe('tokenizer unification', () => {
  const PATTERNS_WITH_EMAIL = { email: true } as const;

  it('produces identical tokenized text in scrubber and tokenizer', () => {
    // Pin: scrubber-tokenize and tokenizer.tokenize must never diverge on
    // token format. They both call `applyTokenization`; this guards
    // against someone splitting them apart.
    const input =
      'Mail alice@a.co and CC bob@b.co. Also alice@a.co for the CC.';
    const scrubber = createScrubber({
      mode: 'tokenize',
      patterns: PATTERNS_WITH_EMAIL,
    });
    const tokenizer = createTokenizer({
      mode: 'tokenize',
      patterns: PATTERNS_WITH_EMAIL,
    });

    const scrubbed = scrubber.scrub(input);
    const tokenized = tokenizer.tokenize(input);

    if (scrubbed.kind !== 'modified') {
      throw new Error('scrubber expected to modify the input');
    }
    expect(scrubbed.text).toBe(tokenized.text);
  });

  it('detokenize leaves `[EMAIL_5]` alone when not in mapping', () => {
    // The AI may hallucinate a token index that the tokenizer never
    // emitted. Detokenize must not touch tokens whose key is missing
    // from the mapping.
    const tokenizer = createTokenizer({
      mode: 'tokenize',
      patterns: PATTERNS_WITH_EMAIL,
    });
    const { mapping } = tokenizer.tokenize('Mail alice@a.co.');
    // Mapping only has `[EMAIL_1]`. Verify upfront.
    expect(mapping['[EMAIL_5]']).toBeUndefined();
    const result = tokenizer.detokenize(
      'I will email [EMAIL_5] right away.',
      mapping,
    );
    expect(result).toBe('I will email [EMAIL_5] right away.');
  });

  it('assigns distinct tokens to case-variant emails (documented behaviour)', () => {
    // Email comparison is byte-equal — `Alice@a.co` and `alice@a.co` are
    // distinct values to the tokenizer. This is intentional: the
    // tokenizer is not a normalizer, and the AI may need to preserve the
    // original casing on the way back. Pin the behaviour so a future
    // change to fold case is a deliberate decision.
    const tokenizer = createTokenizer({
      mode: 'tokenize',
      patterns: PATTERNS_WITH_EMAIL,
    });
    const { text, mapping } = tokenizer.tokenize(
      'Both Alice@a.co and alice@a.co are valid.',
    );
    // Two distinct tokens because the matched text differs byte-wise.
    expect(text).toBe('Both [EMAIL_1] and [EMAIL_2] are valid.');
    expect(mapping['[EMAIL_1]']?.value).toBe('Alice@a.co');
    expect(mapping['[EMAIL_2]']?.value).toBe('alice@a.co');
  });
});

describe('applyTokenization helper', () => {
  it('returns the input unchanged on an empty match list', () => {
    const { text, mapping, segments } = applyTokenization('hello world', []);
    expect(text).toBe('hello world');
    expect(mapping).toEqual({});
    expect(segments).toEqual([]);
  });

  it('splices end-to-start without sorting (ascending input only)', () => {
    // Caller contract: matches MUST come in ascending-start order. We
    // pass two synthetic matches in order and verify the splice produces
    // the expected output.
    const input = 'Mail alice@a.co or bob@b.co.';
    const firstStart = input.indexOf('alice@a.co');
    const secondStart = input.indexOf('bob@b.co');
    const matches: PiiMatch[] = [
      {
        patternName: 'email',
        start: firstStart,
        end: firstStart + 'alice@a.co'.length,
        matchedText: 'alice@a.co',
        replacement: '[EMAIL]',
      },
      {
        patternName: 'email',
        start: secondStart,
        end: secondStart + 'bob@b.co'.length,
        matchedText: 'bob@b.co',
        replacement: '[EMAIL]',
      },
    ];
    const { text, mapping } = applyTokenization(input, matches);
    expect(text).toBe('Mail [EMAIL_1] or [EMAIL_2].');
    expect(mapping['[EMAIL_1]']?.value).toBe('alice@a.co');
    expect(mapping['[EMAIL_2]']?.value).toBe('bob@b.co');
  });
});
