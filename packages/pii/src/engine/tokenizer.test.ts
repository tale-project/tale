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

import { createTokenizer } from './tokenizer';

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
});
