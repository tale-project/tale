/**
 * Fast canary for the pii plugin — the file CI fails first when plumbing
 * breaks.
 *
 * Covers the wiring end to end: the shipped YAML tree loads through the
 * safe loader (43 locale datasets, 12 pattern definitions, every frozen
 * built-in name materialized), the registry seam (defaults, injection,
 * override/add), each scrub mode, custom patterns, normalization
 * defenses, and the detector's edge cases. The 67k-case fixture corpus
 * lives in `data-driven.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BYTES,
  PatternRegistry,
  createScrubber,
  detectPii,
  loadPiiData,
  maskPii,
  pass,
} from '../../lib/pii';
import { BUILT_IN_PII_PATTERN_NAMES } from '../../lib/shared/schemas/pii';

const ALL_PATTERNS_MASK = {
  mode: 'mask' as const,
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
    address: { locales: '*' as const },
    nationalId: { locales: '*' as const },
  },
};

describe('shipped data tree', () => {
  it('loads every yml through the safe loader', () => {
    const data = loadPiiData();
    expect(data.locales.length).toBe(43);
    expect(data.patterns.length).toBe(12);
  });

  it('returns a stable reference while files are unchanged', () => {
    expect(loadPiiData()).toBe(loadPiiData());
  });

  it('materializes every frozen built-in pattern name', () => {
    const registry = PatternRegistry.fromDefaults();
    for (const name of BUILT_IN_PII_PATTERN_NAMES) {
      expect(registry.has(name), `missing built-in pattern: ${name}`).toBe(
        true,
      );
    }
    expect(registry.patternNames().length).toBe(12);
  });

  it('shapes every locale dataset the same way', () => {
    const registry = PatternRegistry.fromDefaults();
    const codes = registry.listLocales();
    expect(codes.length).toBe(43);
    for (const code of codes) {
      const cfg = registry.loadLocale(code);
      expect(cfg.locale).toBe(code);
      expect(cfg.scripts.length).toBeGreaterThan(0);
      expect(cfg.countries.length).toBeGreaterThan(0);
      expect(cfg.phoneContextKeywords.length).toBeGreaterThan(0);
      expect(cfg.cvcContextKeywords.length).toBeGreaterThan(0);
      expect(cfg.address.forms.length).toBeGreaterThan(0);
      expect(cfg.address.requireUppercase).toBeTypeOf('boolean');
      expect(cfg.dateOfBirth, `${code} dateOfBirth`).toBeDefined();
    }
  });

  it('keeps a healthy national-ID footprint across the registry', () => {
    const registry = PatternRegistry.fromDefaults();
    const total = registry
      .listLocales()
      .reduce((n, code) => n + registry.loadLocale(code).nationalIds.length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it('throws on an unknown locale code', () => {
    const registry = PatternRegistry.fromDefaults();
    expect(() => registry.loadLocale('xx')).toThrow(/unknown locale code: xx/);
  });
});

describe('createScrubber — mask mode', () => {
  const scrubber = createScrubber(ALL_PATTERNS_MASK);

  it('passes clean text through unchanged', () => {
    expect(scrubber.scrub('hello, this is a sentence with no PII').kind).toBe(
      'pass',
    );
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
    expect(scrubber.scrub('Send to DE89370400440532013009 please').kind).toBe(
      'pass',
    );
  });

  it('masks a context-anchored phone number', () => {
    const o = scrubber.scrub('Tel: +44 20 7946 0123');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[PHONE\]/);
  });

  it('masks a German Personalausweis (ICAO 9303 check)', () => {
    const o = scrubber.scrub('Ausweisnummer C12345670');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Ausweisnummer [GERMAN_ID]');
  });

  it('does not flag a 9-char SKU that fails the checksum', () => {
    expect(scrubber.scrub('Order T12345678').kind).toBe('pass');
  });

  it('masks a CVC with an English keyword', () => {
    const o = scrubber.scrub('My CVC: 123 on the card');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CVC]');
  });

  it('masks a CVC with a German keyword', () => {
    const o = scrubber.scrub('Kartenprüfnummer: 999');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[CVC]');
  });

  it('masks a MAC address (data-only pattern)', () => {
    const o = scrubber.scrub('Device MAC: AA:BB:CC:DD:EE:FF');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[MAC_ADDRESS]');
  });

  it('masks a JWT', () => {
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
    expect(scrubber.scrub('ID: 4111 1111 1111 1112').kind).toBe('pass');
  });

  it('masks multiple PII types in one message', () => {
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

describe('createScrubber — input clamp', () => {
  const scrubber = createScrubber({ mode: 'mask', patterns: { email: true } });

  it('reports a clamped input as truncated even when nothing matched', () => {
    // A clean prefix says nothing about the tail past the clamp; a caller
    // reading a bare pass as "whole input clean" would index that tail.
    // Word-broken filler: one unbroken 50k-char "word" sends the email
    // pattern quadratic (each position scans ahead for a `@` that never
    // comes) and the scan past vitest's 5s budget on a loaded runner.
    const o = scrubber.scrub(
      `${'xxxx '.repeat(MAX_MESSAGE_BYTES / 5)}write to ada@example.com`,
    );
    expect(o).toEqual(pass(true));
  });

  it('carries no truncated flag on a pass under the clamp', () => {
    expect(scrubber.scrub('nothing to see here')).toEqual({ kind: 'pass' });
    expect(scrubber.scrub('nothing to see here')).not.toEqual(pass(true));
  });
});

describe('createScrubber — tokenize default + modes', () => {
  it('defaults to tokenize mode', () => {
    const scrubber = createScrubber({ patterns: { email: true } });
    const o = scrubber.scrub('write to alice@a.co and bob@b.co');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[EMAIL_1]');
    expect(o.text).toContain('[EMAIL_2]');
    expect(o.text).not.toContain('[EMAIL] ');
  });

  it('reuses the same index for repeated values', () => {
    const scrubber = createScrubber({
      mode: 'tokenize',
      patterns: { email: true },
    });
    const o = scrubber.scrub('cc alice@a.co — original sent to alice@a.co');
    if (o.kind !== 'modified') throw new Error('expected modified outcome');
    expect(o.text).toBe('cc [EMAIL_1] — original sent to [EMAIL_1]');
  });

  it('blocks on every call in block mode (no stale state)', () => {
    const scrubber = createScrubber({
      mode: 'block',
      patterns: { email: true },
    });
    for (let i = 0; i < 3; i++) {
      const o = scrubber.scrub('email me at a@b.co');
      expect(o.kind).toBe('blocked');
      if (o.kind !== 'blocked') return;
      expect(o.categoryIds).toContain('email');
    }
    expect(scrubber.scrub('no PII here').kind).toBe('pass');
  });
});

describe('createScrubber — custom patterns', () => {
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

  it('skips an invalid custom regex without throwing', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: {},
      customPatterns: [{ name: 'broken', regex: '([', replacement: '[X]' }],
    });
    expect(scrubber.scrub('any text').kind).toBe('pass');
  });

  it('rejects a backtracking-prone custom regex', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: {},
      customPatterns: [
        { name: 'evil', regex: '(a+)+$', replacement: '[EVIL]' },
      ],
    });
    expect(scrubber.scrub('aaaaaaaaaaaaaaaaaaaaaaaa!').kind).toBe('pass');
  });
});

describe('PatternRegistry — extension seam', () => {
  it('starts empty via .empty()', () => {
    expect(PatternRegistry.empty().patternNames()).toEqual([]);
  });

  it('clones built-ins via .fromDefaults() (no shared state)', () => {
    const a = PatternRegistry.fromDefaults();
    const b = PatternRegistry.fromDefaults();
    expect(a.patternNames().length).toBeGreaterThan(0);
    expect(b.patternNames()).toEqual(a.patternNames());
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

  it('builds a pure registry from injected data (no filesystem)', () => {
    const registry = PatternRegistry.fromData({
      patterns: [
        {
          name: 'macAddress',
          description: 'test',
          replacement: '[MAC]',
          regex: {
            source: '\\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\\b',
            flags: '',
          },
        },
      ],
      locales: [],
    });
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: { macAddress: true },
      registry,
    });
    const o = scrubber.scrub('MAC AA:BB:CC:DD:EE:FF');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('MAC [MAC]');
  });
});

describe('low-level detectPii / maskPii', () => {
  it('work without a scrubber instance', () => {
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

describe('normalization defenses', () => {
  const scrubber = createScrubber(ALL_PATTERNS_MASK);

  it('catches NFD-decomposed keyword text', () => {
    const nfd = 'Téléphone: +33 1 23 45 67 89';
    const o = scrubber.scrub(nfd);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[PHONE\]/);
  });

  it('strips bidi-mark evasion around an email', () => {
    expect(scrubber.scrub('alice\u200F@example.com').kind).toBe('modified');
  });

  it('strips zero-width characters inside a card number', () => {
    expect(scrubber.scrub('4111\u200C1111\u200C1111\u200C1111').kind).toBe(
      'modified',
    );
  });

  it('survives an NFD-decomposed email without crashing', () => {
    expect(scrubber.scrub('mu\u0308ller@example.com').kind).toBe('modified');
  });
});

describe('edge cases', () => {
  const scrubber = createScrubber(ALL_PATTERNS_MASK);

  it('handles an empty string', () => {
    expect(scrubber.scrub('').kind).toBe('pass');
  });

  it('handles a whitespace-only string', () => {
    expect(scrubber.scrub('   \n\t  ').kind).toBe('pass');
  });

  it('handles very long clean text without a stall', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(1000);
    const start = performance.now();
    const o = scrubber.scrub(text);
    // Generous bound — this catches catastrophic backtracking, not a perf
    // budget; tight bounds flake on loaded CI runners.
    expect(performance.now() - start).toBeLessThan(2000);
    expect(o.kind).toBe('pass');
  });

  it('masks adjacent PII cleanly', () => {
    const o = scrubber.scrub('alice@a.co bob@b.co');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text.match(/\[EMAIL\]/g)?.length).toBe(2);
  });

  it('handles PII at the start and end of text', () => {
    const start = scrubber.scrub('alice@example.com is my email');
    if (start.kind !== 'modified') throw new Error('expected modified');
    expect(start.text).toMatch(/^\[EMAIL\]/);
    const end = scrubber.scrub('My email is alice@example.com');
    if (end.kind !== 'modified') throw new Error('expected modified');
    expect(end.text).toMatch(/\[EMAIL\]$/);
  });

  it('passes CJK and Arabic prose without false positives', () => {
    expect(scrubber.scrub('这是一段没有个人信息的中文文本').kind).toBe('pass');
    expect(scrubber.scrub('هذا نص عربي بدون معلومات شخصية').kind).toBe('pass');
  });

  it('does not mask an out-of-range dotted run as an IP', () => {
    expect(scrubber.scrub('Version 2.0.1.300').kind).toBe('pass');
  });

  it('resolves overlapping matches to one clean replacement', () => {
    const o = scrubber.scrub('Tel: 4111111111111111');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toMatch(/\[PHONE\]|\[CREDIT_CARD\]/);
  });

  it('keeps repeated scrub calls stateless', () => {
    const o1 = scrubber.scrub('alice@a.co');
    const o2 = scrubber.scrub('bob@b.co');
    if (o1.kind !== 'modified' || o2.kind !== 'modified') {
      throw new Error('expected modified outcomes');
    }
    expect(o1.text).toBe('[EMAIL]');
    expect(o2.text).toBe('[EMAIL]');
  });
});
