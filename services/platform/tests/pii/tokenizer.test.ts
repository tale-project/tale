/**
 * Tokenizer round-trip guarantees.
 *
 * The core property: for any input, `detokenize(tokenize(text).text,
 * mapping)` restores the normalized input exactly — tokenization must be
 * lossless for the send-to-model-then-restore flow. Exercised as a
 * property over a per-locale sample of the fixture corpus (real
 * addresses, IDs, and prose in 43 scripts) plus targeted unit cases for
 * indexing, dedup, segments, and model-mangled replies.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PatternRegistry,
  createTokenizer,
  normalizeForDetection,
  type ScrubberOptions,
} from '../../lib/pii';
import { parseYamlOrThrow } from '../../lib/shared/config/yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, 'fixtures');

/** Cases sampled per locale — round-trips are covered as a property, not a census. */
const SAMPLE_PER_LOCALE = 25;

const REGISTRY = PatternRegistry.fromDefaults();

const ALL_PATTERN_OPTIONS: ScrubberOptions = {
  registry: REGISTRY,
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
};

describe('round-trip property over the fixture corpus', () => {
  const tokenizer = createTokenizer(ALL_PATTERN_OPTIONS);

  it.each(REGISTRY.listLocales())(
    'restores originals for locale %s',
    (locale) => {
      const path = join(FIXTURES_ROOT, locale, 'positives.yml');
      if (!existsSync(path)) return;
      const cases =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- frozen corpus data
        (
          parseYamlOrThrow(readFileSync(path, 'utf8'), {
            maxBytes: 32 * 1024 * 1024,
          }) as {
            positives?: Array<{ id: string; input: string }>;
          }
        ).positives;
      if (!cases) return;

      // Deterministic spread across the file instead of just its head.
      const step = Math.max(1, Math.floor(cases.length / SAMPLE_PER_LOCALE));
      for (let i = 0; i < cases.length; i += step) {
        const c = cases[i];
        const result = tokenizer.tokenize(c.input);
        expect(result.truncated).toBe(false);
        const restored = tokenizer.detokenize(result.text, result.mapping);
        expect(restored, `round-trip failed for ${locale}/${c.id}`).toBe(
          normalizeForDetection(c.input),
        );
      }
    },
  );
});

describe('token format and indexing', () => {
  const tokenizer = createTokenizer({
    registry: REGISTRY,
    patterns: { email: true, iban: true },
  });

  it('assigns per-type indexes in detection order', () => {
    const r = tokenizer.tokenize('first a@x.co then b@y.co');
    expect(r.text).toBe('first [EMAIL_1] then [EMAIL_2]');
    expect(r.mapping['[EMAIL_1]']).toEqual({
      value: 'a@x.co',
      type: 'email',
      index: 1,
    });
    expect(r.mapping['[EMAIL_2]']).toEqual({
      value: 'b@y.co',
      type: 'email',
      index: 2,
    });
  });

  it('reuses one token for repeated values', () => {
    const r = tokenizer.tokenize('a@x.co and again a@x.co');
    expect(r.text).toBe('[EMAIL_1] and again [EMAIL_1]');
    expect(Object.keys(r.mapping)).toEqual(['[EMAIL_1]']);
    // Two segments, one mapping entry — the UI sees both spans.
    expect(r.segments).toHaveLength(2);
  });

  it('counts each type independently', () => {
    const r = tokenizer.tokenize(
      'mail a@x.co, account DE89370400440532013000, mail b@y.co',
    );
    expect(r.text).toContain('[EMAIL_1]');
    expect(r.text).toContain('[IBAN_1]');
    expect(r.text).toContain('[EMAIL_2]');
  });

  it('reports segments in the normalized coordinate space', () => {
    const input = 'mail a@x.co now';
    const r = tokenizer.tokenize(input);
    expect(r.segments).toHaveLength(1);
    const seg = r.segments[0];
    expect(input.slice(seg.start, seg.end)).toBe('a@x.co');
    expect(seg.token).toBe('[EMAIL_1]');
    expect(seg.value).toBe('a@x.co');
    expect(seg.type).toBe('email');
  });

  it('returns the input untouched when nothing is enabled', () => {
    const empty = createTokenizer({ registry: REGISTRY, patterns: {} });
    const r = empty.tokenize('a@x.co');
    expect(r.text).toBe('a@x.co');
    expect(r.mapping).toEqual({});
    expect(r.segments).toEqual([]);
  });
});

describe('detokenize resilience', () => {
  const tokenizer = createTokenizer({
    registry: REGISTRY,
    patterns: { email: true },
  });

  it('restores tokens the model reordered, duplicated, or wrapped', () => {
    const r = tokenizer.tokenize('reach me at alice@example.com');
    const reply = `I will CC **[EMAIL_1]** and confirm. ([EMAIL_1] again.)`;
    expect(tokenizer.detokenize(reply, r.mapping)).toBe(
      'I will CC **alice@example.com** and confirm. (alice@example.com again.)',
    );
  });

  it('ignores tokens missing from the mapping', () => {
    const r = tokenizer.tokenize('reach me at alice@example.com');
    expect(tokenizer.detokenize('[EMAIL_9] stays', r.mapping)).toBe(
      '[EMAIL_9] stays',
    );
  });

  it('is a no-op for an empty mapping', () => {
    expect(tokenizer.detokenize('plain text', {})).toBe('plain text');
  });
});
