/**
 * Coverage for newly added national-ID specs and shared checksum builders.
 *
 * Two kinds of assertions:
 *   1. End-to-end via `createScrubber` — given a realistic prose sentence
 *      containing an ID, the scrubber masks it. This is what production
 *      consumers care about; it also exercises the locale wiring.
 *   2. Direct checksum builder tests — calling the builder with a known
 *      valid number returns true, with a deliberately broken one returns
 *      false. Pins the math against future refactors.
 *
 * Numbers here are CONSTRUCTED to pass each respective checksum. Real-
 * world IDs are intentionally avoided so this file stays committable
 * without leaking actual PII into git.
 */

import { describe, expect, it } from 'vitest';

import { createScrubber } from '../../lib/pii';

/**
 * Compute the MOD-10 check digit for a Mexican CURP body (17 chars,
 * with the trailing year-digit already inserted). Matches the builder's
 * algorithm bit-for-bit; we recompute here so the tests are deterministic
 * across any future builder refactor.
 */
function computeMxCurpCheck(body17: string): string {
  const charValue = (c: string): number => {
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return code - 55;
    if (c === 'Ñ') return 24;
    return -1;
  };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += charValue(body17[i] ?? '') * (18 - i);
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Synthesize a valid HKID by computing the check character for the
 * given 7-char prefix (single letter + 6 digits, or two letters + 6
 * digits). Used by the HKID test so the assertion is robust against
 * weight-table refactors.
 */
function synthesizeHkid(prefix: string): string {
  const padded = prefix.length === 7 ? ' ' + prefix : prefix;
  const charValue = (c: string): number => {
    if (c === ' ') return 36;
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return code - 55;
    return 0;
  };
  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += charValue(padded[i] ?? '') * (weights[i] ?? 0);
  }
  const remainder = sum % 11;
  const checkValue = (11 - remainder) % 11;
  const checkChar = checkValue === 10 ? 'A' : String(checkValue);
  return prefix + checkChar;
}
import {
  arCuilCheck,
  auTfnCheck,
  beNrnCheck,
  deSteuerIdCheck,
  ean13Check,
  esDniCheck,
  esNieCheck,
  hkHkidCheck,
  ilTeudatZehutCheck,
  mxCurpCheck,
  nzIrdCheck,
  roCnpCheck,
  sePersonnummerCheck,
  trTcknCheck,
} from '../../lib/pii/patterns/national-ids/builders';

describe('new checksum builders', () => {
  it('EAN-13 — Swiss AHV (756.xxxx.xxxx.xx)', () => {
    // 7569217076985 — constructed: weights [1,3] over 756921707698 = sum 87
    // (10 - 87 % 10) % 10 = 3 → not 5. Use a known-valid AHV scaffold.
    // 7560000000007 → sum (7+5*3+6+0*3+...) = 7 + 15 + 6 + 0 = 28; (10-28%10)%10=2
    // We instead derive: pick first 12 digits and compute check.
    const digits = '756000000000';
    const check = (() => {
      let s = 0;
      for (let i = 0; i < 12; i++)
        s += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
      return (10 - (s % 10)) % 10;
    })();
    expect(ean13Check(digits + String(check))).toBe(true);
    expect(ean13Check(digits + '9')).toBe(false);
    expect(ean13Check('not digits')).toBe(false);
  });

  it('Spanish DNI letter check', () => {
    // The DNI letter for 12345678 is Z (12345678 % 23 = 14 → 'Z').
    expect(esDniCheck('12345678Z')).toBe(true);
    expect(esDniCheck('12345678A')).toBe(false);
  });

  it('Spanish NIE letter check', () => {
    // X1234567 → number 01234567 → 01234567 % 23 = 14 → 'Z'
    // Y1234567 → number 11234567 → 11234567 % 23 = 1 → 'R'
    // Z1234567 → number 21234567 → 21234567 % 23 = 11 → 'B'
    expect(esNieCheck('X1234567L')).toBe(true);
    expect(esNieCheck('Y1234567X')).toBe(true);
    expect(esNieCheck('X1234567Z')).toBe(false);
  });

  it('Belgian NRN — both pre-2000 and post-2000 forms', () => {
    // Pre-2000 (e.g. born 1980-04-15, counter 123): base = 800415123 → 800415123 % 97 = 96 → check 1
    const pre2000Base = 800415123;
    const pre2000Check = 97 - (pre2000Base % 97);
    expect(
      beNrnCheck(
        String(pre2000Base).padStart(9, '0') +
          String(pre2000Check).padStart(2, '0'),
      ),
    ).toBe(true);
    // Post-2000 (born 2010-04-15, counter 123): base + 2_000_000_000
    const post2000Base = 100415123;
    const post2000Check = 97 - ((2_000_000_000 + post2000Base) % 97);
    expect(
      beNrnCheck(
        String(post2000Base).padStart(9, '0') +
          String(post2000Check).padStart(2, '0'),
      ),
    ).toBe(true);
    expect(beNrnCheck('80041512399')).toBe(false);
  });

  it('Australian TFN — weighted mod 11', () => {
    // 123456782 — weighted mod 11 check
    expect(auTfnCheck('123456782')).toBe(true);
    expect(auTfnCheck('123456789')).toBe(false);
    expect(auTfnCheck('12345')).toBe(false);
  });

  it('New Zealand IRD — Inland Revenue algorithm', () => {
    // 49091850 is published as a valid sample (8-digit form, primary weights).
    expect(nzIrdCheck('49091850')).toBe(true);
    expect(nzIrdCheck('11111111')).toBe(false);
  });

  it('Argentinian CUIL/CUIT', () => {
    // 20-12345678-6 — weights sum to 148; 148 % 11 = 5; 11-5 = 6.
    expect(arCuilCheck('20123456786')).toBe(true);
    expect(arCuilCheck('20123456780')).toBe(false);
  });

  it('Hong Kong HKID — letter + digits + check', () => {
    // Constructed valid sample: AB123456A
    // A(10)*9 + B(11)*8 + 1*7 + 2*6 + 3*5 + 4*4 + 5*3 + 6*2 = 90+88+7+12+15+16+15+12 = 255
    // (255 + 10) % 11 = 265 % 11 = 1 ≠ 0 → not valid. Try A123456(3): A(10)*9 + ' '(36)*8 ...
    // Use a synthesized valid HKID via the helper.
    const valid = synthesizeHkid('A123456');
    expect(hkHkidCheck(valid)).toBe(true);
    expect(hkHkidCheck('A1234560')).toBe(false);
  });

  it('Mexican CURP — final mod-10 check', () => {
    // Compute the correct mod-10 check for GOMC700101HDFXXX0?
    const body = 'GOMC700101HDFXXX0';
    const check = computeMxCurpCheck(body);
    expect(mxCurpCheck(body + check)).toBe(true);
    const wrong = String((Number(check) + 1) % 10);
    expect(mxCurpCheck(body + wrong)).toBe(false);
  });

  it('German Steuer-ID — MOD 11,10 with structural rule', () => {
    // Constructed sample passing both the digit-pattern rule and the
    // MOD-11,10 check digit (published sample: 65929970489).
    expect(deSteuerIdCheck('65929970489')).toBe(true);
    expect(deSteuerIdCheck('65929970480')).toBe(false);
    // Leading zero rejected
    expect(deSteuerIdCheck('05929970489')).toBe(false);
  });

  it('Romanian CNP', () => {
    // 1800101220011 — male born 1980-01-01, county 22, counter 001, check 1
    expect(roCnpCheck('1800101220011')).toBe(true);
    expect(roCnpCheck('1800101220019')).toBe(false);
  });

  it('Turkish TC Kimlik No', () => {
    // 10000000146 — constructed sample passing both check digits
    expect(trTcknCheck('10000000146')).toBe(true);
    expect(trTcknCheck('10000000140')).toBe(false);
    // Leading zero rejected
    expect(trTcknCheck('00000000146')).toBe(false);
  });

  it('Swedish Personnummer — 10 and 12 digit forms', () => {
    // 811218-9876 — a synthesized valid 10-digit personnummer (Luhn ok)
    expect(sePersonnummerCheck('8112189876')).toBe(true);
    expect(sePersonnummerCheck('198112189876')).toBe(true);
    expect(sePersonnummerCheck('8112189870')).toBe(false);
  });

  it('Israeli Teudat Zehut — mod-10 Luhn variant', () => {
    // 123456782 (9 digits) passes
    expect(ilTeudatZehutCheck('123456782')).toBe(true);
    expect(ilTeudatZehutCheck('123456789')).toBe(false);
  });
});

describe('scrubber — Swiss + other new IDs end-to-end', () => {
  const scrubber = createScrubber({
    mode: 'mask',
    patterns: {
      nationalId: { locales: '*' },
    },
  });

  it('masks a Swiss AHV / AVS number', () => {
    // Construct an AHV with valid EAN-13 check digit.
    const body = '756000000000';
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (s % 10)) % 10;
    const ahv = body + String(check);
    const o = scrubber.scrub(`AHV-Nr: ${ahv}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[SWISS_AHV]');
  });

  it('masks a Swiss UID', () => {
    const o = scrubber.scrub('Firmen UID: CHE-123.456.789');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[SWISS_UID]');
  });

  it('masks a German Steuer-ID', () => {
    const o = scrubber.scrub('Steuer-ID: 65 929 970 489');
    // The pattern is space-separated; with the constructed valid number
    // the masker should produce [DE_STEUER_ID].
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[DE_STEUER_ID]');
  });

  it('masks a Belgian NRN', () => {
    // Build a valid post-2000 NRN: born 2010-04-15, counter 123.
    const base = 100415123;
    const check = 97 - ((2_000_000_000 + base) % 97);
    const baseStr = String(base).padStart(9, '0');
    const formatted = `${baseStr.slice(0, 2)}.${baseStr.slice(2, 4)}.${baseStr.slice(4, 6)}-${baseStr.slice(6, 9)}.${String(check).padStart(2, '0')}`;
    const o = scrubber.scrub(`Rijksregisternummer ${formatted}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[BE_NRN]');
  });

  it('masks a Mexican CURP', () => {
    const body = 'GOMC700101HDFXXX0';
    const curp = body + computeMxCurpCheck(body);
    const o = scrubber.scrub(`CURP: ${curp}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[MX_CURP]');
  });

  it('does not mask a near-CURP with a wrong checksum', () => {
    const body = 'GOMC700101HDFXXX0';
    const wrong = body + String((Number(computeMxCurpCheck(body)) + 1) % 10);
    const o = scrubber.scrub(`CURP: ${wrong}`);
    expect(o.kind).toBe('pass');
  });

  it('masks an Argentinian CUIL', () => {
    const o = scrubber.scrub('CUIL/CUIT: 20-12345678-6');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[AR_CUIL]');
  });

  it('masks a Hong Kong HKID', () => {
    const valid = synthesizeHkid('A123456');
    const o = scrubber.scrub(`HKID: ${valid}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[HK_HKID]');
  });
});

describe('createScrubber — default mode is tokenize', () => {
  it('emits indexed tokens with no explicit mode option', () => {
    const scrubber = createScrubber({ patterns: { email: true } });
    const o = scrubber.scrub('Contact alice@example.com or bob@example.com.');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[EMAIL_1]');
    expect(o.text).toContain('[EMAIL_2]');
  });

  it('keeps the same index for repeated values', () => {
    const scrubber = createScrubber({ patterns: { email: true } });
    const o = scrubber.scrub(
      'Send to alice@example.com. CC alice@example.com again.',
    );
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect((o.text.match(/\[EMAIL_1\]/g) ?? []).length).toBe(2);
    expect(o.text).not.toContain('[EMAIL_2]');
  });

  it('does not emit feedback when no PII present', () => {
    const scrubber = createScrubber({ patterns: { email: true } });
    const o = scrubber.scrub('No personal data here whatsoever.');
    expect(o.kind).toBe('pass');
  });

  it('still honours explicit mask mode', () => {
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: { email: true },
    });
    const o = scrubber.scrub('alice@example.com');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('[EMAIL]');
  });

  it('still honours explicit block mode (every block fires)', () => {
    const scrubber = createScrubber({
      mode: 'block',
      patterns: { email: true },
    });
    // Repeat-block invariant: each scrub call returns blocked
    // independently — the engine is pure, no stale state suppresses the
    // second feedback. Counterpart to the toast-store fix that ensures
    // repeat block toasts also surface on the UI.
    for (let i = 0; i < 3; i++) {
      const o = scrubber.scrub('alice@example.com');
      expect(o.kind).toBe('blocked');
    }
  });
});
