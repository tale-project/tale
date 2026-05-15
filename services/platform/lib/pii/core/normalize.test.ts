import { describe, expect, it } from 'vitest';

import { normalizeForDetection } from './normalize';

describe('normalizeForDetection', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(normalizeForDetection('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeForDetection('')).toBe('');
  });

  it('recomposes NFD to NFC (combining acute)', () => {
    const decomposed = 'Tél';
    expect(normalizeForDetection(decomposed)).toBe('Tél');
  });

  it('strips left-to-right mark (U+200E)', () => {
    expect(normalizeForDetection('a‎b')).toBe('ab');
  });

  it('strips right-to-left mark (U+200F)', () => {
    expect(normalizeForDetection('a‏b')).toBe('ab');
  });

  it('strips bidi embedding/override marks (U+202A–U+202E)', () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e]) {
      const ch = String.fromCharCode(code);
      expect(normalizeForDetection(`x${ch}y`)).toBe('xy');
    }
  });

  it('strips bidi isolate controls (U+2066–U+2069)', () => {
    for (const code of [0x2066, 0x2067, 0x2068, 0x2069]) {
      const ch = String.fromCharCode(code);
      expect(normalizeForDetection(`x${ch}y`)).toBe('xy');
    }
  });

  it('strips zero-width space (U+200B)', () => {
    expect(normalizeForDetection('a​b')).toBe('ab');
  });

  it('strips zero-width non-joiner (U+200C)', () => {
    expect(normalizeForDetection('a‌b')).toBe('ab');
  });

  it('strips zero-width joiner (U+200D)', () => {
    expect(normalizeForDetection('a‍b')).toBe('ab');
  });

  it('strips word joiner (U+2060)', () => {
    expect(normalizeForDetection('a⁠b')).toBe('ab');
  });

  it('strips BOM / zero-width no-break space (U+FEFF)', () => {
    expect(normalizeForDetection('a﻿b')).toBe('ab');
  });

  it('strips soft hyphen (U+00AD)', () => {
    expect(normalizeForDetection('a­b')).toBe('ab');
  });

  it('strips multiple invisible chars in one pass', () => {
    const input = '‎hello​world‍!﻿';
    expect(normalizeForDetection(input)).toBe('helloworld!');
  });

  it('preserves combining marks that NFC requires', () => {
    expect(normalizeForDetection('café')).toBe('café');
    expect(normalizeForDetection('cañon')).toBe('cañon');
  });

  it('is idempotent', () => {
    const input = 'Tél‎ hòla‍';
    const once = normalizeForDetection(input);
    expect(normalizeForDetection(once)).toBe(once);
  });

  it('strips invisible chars before NFC so base+mark pairs compose', () => {
    const input = 'e‍́';
    expect(normalizeForDetection(input)).toBe('é');
  });

  it('unblocks email regex from zero-width-joiner evasion', () => {
    const obfuscated = 'alice@ex‍ample.com';
    const cleaned = normalizeForDetection(obfuscated);
    expect(cleaned).toBe('alice@example.com');
    expect(/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(cleaned)).toBe(true);
  });

  it('preserves visible whitespace and punctuation', () => {
    expect(normalizeForDetection(' Hello, world.\n')).toBe(' Hello, world.\n');
  });
});
