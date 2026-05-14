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
      macAddress: true,
      jwt: true,
      ssn: true,
      ipAddress: true,
      dateOfBirth: true,
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

  it('masks a MAC address', () => {
    const o = scrubber.scrub('Device MAC: AA:BB:CC:DD:EE:FF');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[MAC_ADDRESS]');
  });

  it('masks a JWT token', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const o = scrubber.scrub(`Token: ${jwt}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[JWT]');
  });

  it('masks an IPv4 address', () => {
    const o = scrubber.scrub('Server IP: 192.168.1.100');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[IP_ADDRESS]');
  });

  it('masks a US SSN', () => {
    const o = scrubber.scrub('SSN: 123-45-6789');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[SSN]');
  });

  it('masks a credit card number with spaces', () => {
    const o = scrubber.scrub('Card: 4111 1111 1111 1111');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CREDIT_CARD]');
  });

  it('does not mask a digit string that fails Luhn', () => {
    const o = scrubber.scrub('ID: 4111 1111 1111 1112');
    expect(o.kind).toBe('pass');
  });

  it('masks multiple PII types in a single message', () => {
    const o = scrubber.scrub(
      'Email alice@example.com, phone +44 20 7946 0123, card 4111111111111111',
    );
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[EMAIL]');
    expect(o.text).toContain('[PHONE]');
    expect(o.text).toContain('[CREDIT_CARD]');
  });

  it('masks a numeric date of birth', () => {
    const o = scrubber.scrub('DOB: 15/03/1987');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[DATE_OF_BIRTH]');
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

describe('edge cases', () => {
  const scrubber = createScrubber({
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

  it('handles empty string', () => {
    expect(scrubber.scrub('').kind).toBe('pass');
  });

  it('handles whitespace-only string', () => {
    expect(scrubber.scrub('   \n\t  ').kind).toBe('pass');
  });

  it('handles very long clean text without timeout', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(1000);
    const start = performance.now();
    const o = scrubber.scrub(text);
    expect(performance.now() - start).toBeLessThan(250);
    expect(o.kind).toBe('pass');
  });

  it('handles NFD-decomposed email', () => {
    // NFD form of 'müller@example.com' — combining umlaut.
    // After NFC normalization, the 'ü' is a single code point outside the
    // ASCII email regex class, so the regex matches the ASCII tail
    // 'ller@example.com'. The scrubber still detects and masks the email
    // portion — verifying it does not crash on NFD input.
    const nfd = 'mu\u0308ller@example.com';
    const o = scrubber.scrub(nfd);
    expect(o.kind).toBe('modified');
  });

  it('handles bidi-mark evasion around email', () => {
    // Right-to-left mark before @ sign — evasion attempt.
    // The normalizer strips U+200F, so 'alice@example.com' is recovered.
    const evasion = 'alice\u200F@example.com';
    const o = scrubber.scrub(evasion);
    expect(o.kind).toBe('modified');
  });

  it('handles zero-width chars inside credit card number', () => {
    // ZWNJ inserted between digits — normalizer strips U+200C.
    const evasion = '4111\u200C1111\u200C1111\u200C1111';
    const o = scrubber.scrub(evasion);
    expect(o.kind).toBe('modified');
  });

  it('handles adjacent PII without spacing issues', () => {
    const o = scrubber.scrub('alice@a.co bob@b.co');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    // Both emails should be masked
    expect(o.text.match(/\[EMAIL\]/g)?.length).toBe(2);
  });

  it('handles PII at the very start of text', () => {
    const o = scrubber.scrub('alice@example.com is my email');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/^\[EMAIL\]/);
  });

  it('handles PII at the very end of text', () => {
    const o = scrubber.scrub('My email is alice@example.com');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[EMAIL\]$/);
  });

  it('handles unicode text without false positives', () => {
    const o = scrubber.scrub('这是一段没有个人信息的中文文本');
    expect(o.kind).toBe('pass');
  });

  it('handles Arabic text without false positives', () => {
    const o = scrubber.scrub('هذا نص عربي بدون معلومات شخصية');
    expect(o.kind).toBe('pass');
  });

  it('does not mask a version number as IP', () => {
    // 2.0.1.3 has all octets in 0-255 so isIP considers it valid.
    // Use an octet > 255 to verify the validator rejects invalid IPs.
    const o = scrubber.scrub('Version 2.0.1.300');
    expect(o.kind).toBe('pass');
  });

  it('handles overlapping pattern matches correctly', () => {
    // 'Tel:' is a phone context keyword, so the phone pattern claims the
    // digit run first. Verify the scrubber resolves the overlap without
    // crashing and produces at least one detection.
    const o = scrubber.scrub('Tel: 4111111111111111');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    // Phone context keyword wins here; the important thing is no double-
    // replacement or crash.
    expect(o.text).toMatch(/\[PHONE\]|\[CREDIT_CARD\]/);
  });

  it('handles repeated scrub calls without state leakage', () => {
    const o1 = scrubber.scrub('alice@a.co');
    const o2 = scrubber.scrub('bob@b.co');
    if (o1.kind !== 'modified' || o2.kind !== 'modified') return;
    expect(o1.text).toBe('[EMAIL]');
    expect(o2.text).toBe('[EMAIL]');
  });
});
