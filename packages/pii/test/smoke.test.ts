/**
 * End-to-end smoke test.
 *
 * Verifies the scrubber wires together correctly across all entry shapes:
 *   - locale registry loads + validates the 5 shipped JSON files
 *   - factory pattern composition produces working regexes
 *   - mask mode rewrites detected PII; block mode short-circuits
 *   - universal patterns (email, IBAN, credit card) ignore locale selection
 *   - locale-composed patterns (phone, cvc, address) honor it
 *
 * Heavy data-driven coverage lives in `data-driven.test.ts`; this file is
 * the canary the CI runs first to fail fast on plumbing regressions.
 */

import { describe, expect, it } from 'vitest';

import {
  createScrubber,
  detectPii,
  listLocales,
  loadLocale,
  maskPii,
  PatternRegistry,
} from '../src';

describe('locale registry', () => {
  it('loads at least the core shipped locales', () => {
    // We assert *at least* the core set is loaded. New locales added in
    // later phases extend the list; pinning a closed set would make the
    // smoke test brittle across phase boundaries.
    const codes = new Set(listLocales());
    for (const required of ['de', 'en', 'fr', 'it', 'nl']) {
      expect(codes.has(required)).toBe(true);
    }
  });

  it('throws on unknown locale', () => {
    expect(() => loadLocale('xx')).toThrow(/unknown locale code: xx/);
  });

  it('shapes each locale config the same way', () => {
    for (const code of listLocales()) {
      const cfg = loadLocale(code);
      expect(cfg.locale).toBe(code);
      expect(cfg.scripts.length).toBeGreaterThan(0);
      expect(cfg.countries.length).toBeGreaterThan(0);
      expect(cfg.phoneContextKeywords.length).toBeGreaterThan(0);
      expect(cfg.cvcContextKeywords.length).toBeGreaterThan(0);
      expect(cfg.address.requireUppercase).toBeTypeOf('boolean');
    }
  });
});

describe('createScrubber — mask mode', () => {
  const scrubber = createScrubber({
    mode: 'mask',
    patterns: {
      email: true,
      phone: true,
      creditCard: true,
      iban: true,
      cvc: true,
      address: { locales: '*' },
      nationalId: { locales: '*' },
    },
  });

  it('passes clean text through unchanged', () => {
    const o = scrubber.scrub('hello, this is a sentence with no PII');
    expect(o.kind).toBe('pass');
  });

  it('masks an email', () => {
    const o = scrubber.scrub('contact me at alice@example.com today');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('contact me at [EMAIL] today');
    expect(o.categoryIds).toContain('email');
  });

  it('masks an IBAN (mod-97 validated)', () => {
    const o = scrubber.scrub('Send to DE89370400440532013000 please');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Send to [IBAN] please');
  });

  it('rejects a near-IBAN that fails mod-97', () => {
    const o = scrubber.scrub('Send to DE89370400440532013009 please');
    expect(o.kind).toBe('pass');
  });

  it('masks a context-anchored phone number across locales', () => {
    // EN keyword
    const o = scrubber.scrub('Tel: +44 20 7946 0123');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[PHONE\]/);
  });

  it('masks a German Personalausweis (ICAO 9303 check)', () => {
    // Constructed ID that passes the cyclic [7,3,1] mod-10 check:
    // sum(C×7,1×3,2×1,3×7,4×3,5×1,6×7,7×3) = 190; 190 mod 10 = 0.
    const o = scrubber.scrub('Ausweisnummer C12345670');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Ausweisnummer [GERMAN_ID]');
  });

  it('does not flag a 9-char SKU that fails the checksum', () => {
    const o = scrubber.scrub('Order T12345678');
    expect(o.kind).toBe('pass');
  });

  it('masks a CVC with English keyword', () => {
    const o = scrubber.scrub('My CVC: 123 on the card');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CVC]');
  });

  it('masks a CVC with German keyword', () => {
    const o = scrubber.scrub('Kartenprüfnummer: 999');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CVC]');
  });
});

describe('createScrubber — tokenize default + mode', () => {
  it('defaults to tokenize mode when no mode is passed', () => {
    const scrubber = createScrubber({ patterns: { email: true } });
    const o = scrubber.scrub('write to alice@a.co and bob@b.co');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    // Tokenize produces indexed tokens, not generic `[EMAIL]`.
    expect(o.text).toContain('[EMAIL_1]');
    expect(o.text).toContain('[EMAIL_2]');
    expect(o.text).not.toContain('[EMAIL]');
  });

  it('reuses the same index for repeat occurrences', () => {
    const scrubber = createScrubber({
      mode: 'tokenize',
      patterns: { email: true },
    });
    const o = scrubber.scrub('cc alice@a.co — original sent to alice@a.co');
    if (o.kind !== 'modified') throw new Error('expected modified outcome');
    // Same email twice → both tokens carry index 1.
    expect(o.text).toBe('cc [EMAIL_1] — original sent to [EMAIL_1]');
  });
});

describe('createScrubber — block mode', () => {
  const scrubber = createScrubber({
    mode: 'block',
    patterns: { email: true },
  });

  it('returns blocked on detection', () => {
    const o = scrubber.scrub('email me at a@b.co');
    expect(o.kind).toBe('blocked');
    if (o.kind !== 'blocked') return;
    expect(o.categoryIds).toContain('email');
  });

  it('passes when no match', () => {
    const o = scrubber.scrub('no PII here');
    expect(o.kind).toBe('pass');
  });
});

describe('createScrubber — custom pattern', () => {
  it('accepts a user-supplied regex', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: {},
      customPatterns: [
        { name: 'orderId', regex: 'ORD-\\d{6}', replacement: '[ORDER_ID]' },
      ],
    });
    const o = scrubber.scrub('Your order ORD-123456 is shipping');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Your order [ORDER_ID] is shipping');
  });

  it('skips a custom pattern with invalid regex (does not throw)', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: {},
      customPatterns: [{ name: 'broken', regex: '([', replacement: '[X]' }],
    });
    const o = scrubber.scrub('any text');
    expect(o.kind).toBe('pass');
  });
});

describe('PatternRegistry — extension', () => {
  it('starts empty when constructed with .empty()', () => {
    const r = PatternRegistry.empty();
    expect(r.list()).toEqual([]);
  });

  it('clones built-ins via .fromDefaults() (no shared state)', () => {
    const a = PatternRegistry.fromDefaults();
    const b = PatternRegistry.fromDefaults();
    expect(a.list().length).toBeGreaterThan(0);
    expect(b.list()).toEqual(a.list());
    // Mutating one should not affect the other.
    a.add('extra', () => []);
    expect(b.get('extra')).toBeUndefined();
  });

  it('throws on .add() of a duplicate name', () => {
    const r = PatternRegistry.fromDefaults();
    expect(() => r.add('email', () => [])).toThrow(/already registered/);
  });

  it('.override() replaces an existing factory', () => {
    const r = PatternRegistry.fromDefaults().override('email', () => [
      { name: 'email', regex: /override/g, replacement: '[OVERRIDDEN]' },
    ]);
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: { email: true },
      registry: r,
    });
    const o = scrubber.scrub('say override here, not a@b.co');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[OVERRIDDEN]');
    expect(o.text).toContain('a@b.co');
  });
});

describe('low-level detectPii / maskPii', () => {
  it('works without a Scrubber instance', () => {
    const patterns = [
      {
        name: 'email',
        regex: /[a-z]+@[a-z]+\.[a-z]+/g,
        replacement: '[EMAIL]',
      },
    ];
    const matches = detectPii('mail me at hi@a.co', patterns);
    expect(matches).toHaveLength(1);
    expect(maskPii('mail me at hi@a.co', matches)).toBe('mail me at [EMAIL]');
  });
});

describe('normalization', () => {
  it('catches NFD-decomposed strings', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: { phone: true },
    });
    // 'Téléphone' typed as NFD (combining acute U+0301 after T-e and e).
    const nfd = 'Téléphone: +33 1 23 45 67 89';
    const o = scrubber.scrub(nfd);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[PHONE\]/);
  });
});
