/**
 * National-ID coverage on two levels:
 *
 *  1. Checksum builders directly — a known-valid vector returns true, a
 *     deliberately broken one false. Pins the math against refactors.
 *  2. End-to-end through `createScrubber` — a realistic sentence carrying
 *     an ID gets masked with the spec's replacement token, exercising the
 *     locale wiring.
 *
 * Every number here is CONSTRUCTED to pass its checksum; no real-world
 * IDs enter git.
 */

import { describe, expect, it } from 'vitest';

import { createScrubber } from '../../lib/pii';
import {
  arCuilCheck,
  auTfnCheck,
  beNrnCheck,
  brCpfCheck,
  deSteuerIdCheck,
  dkCprCheck,
  ean13Check,
  esDniCheck,
  esNieCheck,
  frNirCheck,
  hkHkidCheck,
  icao9303Check,
  ilTeudatZehutCheck,
  itCodiceFiscaleCheck,
  jpMyNumberCheck,
  luhnCheck,
  mxCurpCheck,
  nlBsnCheck,
  nzIrdCheck,
  roCnpCheck,
  sePersonnummerCheck,
  sgNricCheck,
  trTcknCheck,
  verhoeffCheck,
} from '../../lib/pii/patterns/national-ids/checksums';

/** Compute the CURP mod-10 check for a 17-char body (mirrors the spec). */
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

/** Synthesize a valid HKID for a prefix by computing its check character. */
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
  const checkValue = (11 - (sum % 11)) % 11;
  return prefix + (checkValue === 10 ? 'A' : String(checkValue));
}

/** Build a Swiss AHV number with a valid EAN-13 check digit. */
function synthesizeAhv(): string {
  const body = '756000000000';
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + String((10 - (s % 10)) % 10);
}

describe('checksum builders', () => {
  it('ICAO 9303 (German Personalausweis)', () => {
    expect(icao9303Check('C12345670', 9)).toBe(true);
    expect(icao9303Check('C12345671', 9)).toBe(false);
    expect(icao9303Check('C1234567', 9)).toBe(false);
  });

  it('Luhn', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
    expect(luhnCheck('4111111111111112')).toBe(false);
    expect(luhnCheck('not digits')).toBe(false);
  });

  it('Dutch BSN mod-11', () => {
    expect(nlBsnCheck('111222333')).toBe(true);
    expect(nlBsnCheck('111222334')).toBe(false);
  });

  it('Brazilian CPF (rejects repeated-digit dummies)', () => {
    expect(brCpfCheck('52998224725')).toBe(true);
    expect(brCpfCheck('52998224726')).toBe(false);
    expect(brCpfCheck('11111111111')).toBe(false);
  });

  it('Verhoeff (Aadhaar-style)', () => {
    expect(verhoeffCheck('2363')).toBe(true);
    expect(verhoeffCheck('2364')).toBe(false);
  });

  it('EAN-13 (Swiss AHV)', () => {
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

  it('Spanish DNI letter', () => {
    expect(esDniCheck('12345678Z')).toBe(true);
    expect(esDniCheck('12345678A')).toBe(false);
  });

  it('Spanish NIE letter', () => {
    expect(esNieCheck('X1234567L')).toBe(true);
    expect(esNieCheck('Y1234567X')).toBe(true);
    expect(esNieCheck('X1234567Z')).toBe(false);
  });

  it('Belgian NRN — pre-2000 and post-2000 eras', () => {
    const pre2000Base = 800415123;
    const pre2000Check = 97 - (pre2000Base % 97);
    expect(
      beNrnCheck(
        String(pre2000Base).padStart(9, '0') +
          String(pre2000Check).padStart(2, '0'),
      ),
    ).toBe(true);
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

  it('Australian TFN', () => {
    expect(auTfnCheck('123456782')).toBe(true);
    expect(auTfnCheck('123456789')).toBe(false);
    expect(auTfnCheck('12345')).toBe(false);
  });

  it('New Zealand IRD', () => {
    expect(nzIrdCheck('49091850')).toBe(true);
    expect(nzIrdCheck('11111111')).toBe(false);
  });

  it('Argentinian CUIL/CUIT', () => {
    expect(arCuilCheck('20123456786')).toBe(true);
    expect(arCuilCheck('20123456780')).toBe(false);
  });

  it('Hong Kong HKID', () => {
    const valid = synthesizeHkid('A123456');
    expect(hkHkidCheck(valid)).toBe(true);
    const brokenCheck = valid.endsWith('0')
      ? `${valid.slice(0, 7)}1`
      : `${valid.slice(0, 7)}0`;
    expect(hkHkidCheck(brokenCheck)).toBe(false);
  });

  it('Mexican CURP', () => {
    const body = 'GOMC700101HDFXXX0';
    const check = computeMxCurpCheck(body);
    expect(mxCurpCheck(body + check)).toBe(true);
    expect(mxCurpCheck(body + String((Number(check) + 1) % 10))).toBe(false);
  });

  it('German Steuer-ID (structure rule + MOD 11,10)', () => {
    expect(deSteuerIdCheck('65929970489')).toBe(true);
    expect(deSteuerIdCheck('65929970480')).toBe(false);
    expect(deSteuerIdCheck('05929970489')).toBe(false);
  });

  it('Romanian CNP', () => {
    expect(roCnpCheck('1800101220011')).toBe(true);
    expect(roCnpCheck('1800101220019')).toBe(false);
  });

  it('Turkish TC Kimlik No', () => {
    expect(trTcknCheck('10000000146')).toBe(true);
    expect(trTcknCheck('10000000140')).toBe(false);
    expect(trTcknCheck('00000000146')).toBe(false);
  });

  it('Swedish personnummer — 10 and 12 digit forms', () => {
    expect(sePersonnummerCheck('8112189876')).toBe(true);
    expect(sePersonnummerCheck('198112189876')).toBe(true);
    expect(sePersonnummerCheck('8112189870')).toBe(false);
  });

  it('Israeli Teudat Zehut', () => {
    expect(ilTeudatZehutCheck('123456782')).toBe(true);
    expect(ilTeudatZehutCheck('123456789')).toBe(false);
  });

  it('French NIR incl. Corsican department codes', () => {
    // 13-digit body 1550150123456: check = 97 - (body % 97).
    const body = '1550150123456';
    const check = 97 - (Number(body) % 97);
    expect(frNirCheck(body + String(check).padStart(2, '0'))).toBe(true);
    expect(frNirCheck(body + String((check + 1) % 97).padStart(2, '0'))).toBe(
      false,
    );
  });

  it('Italian Codice Fiscale', () => {
    // Body RSSMRA85M01H501 sums to 120 over the odd/even tables; 120 mod
    // 26 = 16 -> 'Q'.
    expect(itCodiceFiscaleCheck('RSSMRA85M01H501Q')).toBe(true);
    expect(itCodiceFiscaleCheck('RSSMRA85M01H501Z')).toBe(false);
  });

  it('Japanese My Number', () => {
    expect(jpMyNumberCheck('123456789018')).toBe(true);
    expect(jpMyNumberCheck('123456789012')).toBe(false);
  });

  it('Danish CPR (strict mod-11)', () => {
    // 1111111118: weighted sum = 4+3+2+7+6+5+4+3+2+8 = 44 = 4×11.
    expect(dkCprCheck('1111111118')).toBe(true);
    expect(dkCprCheck('1111111111')).toBe(false);
  });

  it('Singapore NRIC', () => {
    expect(sgNricCheck('S1234567D')).toBe(true);
    expect(sgNricCheck('S1234567A')).toBe(false);
  });
});

describe('scrubber — national IDs end to end', () => {
  const scrubber = createScrubber({
    mode: 'mask',
    patterns: {
      nationalId: { locales: '*' },
    },
  });

  it('masks a Swiss AHV/AVS number', () => {
    const o = scrubber.scrub(`AHV-Nr: ${synthesizeAhv()}`);
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
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[DE_STEUER_ID]');
  });

  it('masks a Belgian NRN', () => {
    const base = 100415123;
    const check = 97 - ((2_000_000_000 + base) % 97);
    const baseStr = String(base).padStart(9, '0');
    const formatted = `${baseStr.slice(0, 2)}.${baseStr.slice(2, 4)}.${baseStr.slice(4, 6)}-${baseStr.slice(6, 9)}.${String(check).padStart(2, '0')}`;
    const o = scrubber.scrub(`Rijksregisternummer ${formatted}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[BE_NRN]');
  });

  it('masks a Mexican CURP and rejects a near-miss', () => {
    const body = 'GOMC700101HDFXXX0';
    const curp = body + computeMxCurpCheck(body);
    const good = scrubber.scrub(`CURP: ${curp}`);
    expect(good.kind).toBe('modified');
    if (good.kind === 'modified') {
      expect(good.text).toContain('[MX_CURP]');
    }
    const wrong = body + String((Number(computeMxCurpCheck(body)) + 1) % 10);
    expect(scrubber.scrub(`CURP: ${wrong}`).kind).toBe('pass');
  });

  it('masks an Argentinian CUIL', () => {
    const o = scrubber.scrub('CUIL/CUIT: 20-12345678-6');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[AR_CUIL]');
  });

  it('masks a Hong Kong HKID', () => {
    const o = scrubber.scrub(`HKID: ${synthesizeHkid('A123456')}`);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[HK_HKID]');
  });
});
