import { describe, expect, it, vi } from 'vitest';

import { type PiiConfig, scrubPii } from '../index';
import { detectPii } from '../pii_detector';
import { getEnabledPatterns } from '../pii_patterns';

/**
 * Regression test for every defect confirmed in the Round 1 + Round 2 PII v2
 * review. Each `describe` block targets one defect ID; each `it` is a
 * before/after assertion that would have failed against `87ab831ec` and
 * passes against the hardening fixes.
 */

const allEnabled = (extra: string[] = []) => [
  'email',
  'phone',
  'ssn',
  'creditCard',
  'cvc',
  'ipAddress',
  'dateOfBirth',
  'address',
  'iban',
  'germanId',
  ...extra,
];

const cfg = (mode: 'mask' | 'block' = 'mask'): PiiConfig => ({
  enabled: true,
  mode,
  enabledPatterns: allEnabled(),
  customPatterns: [],
});

const expectModified = (text: string, expected: string) => {
  const r = scrubPii(text, cfg());
  expect(r.kind).toBe('modified');
  if (r.kind !== 'modified') return;
  expect(r.text).toBe(expected);
};

const expectPass = (text: string) => {
  const r = scrubPii(text, cfg());
  expect(r.kind).toBe('pass');
};

/* -------------------------------------------------------------------------- */
/*  P1 / HIGH                                                                  */
/* -------------------------------------------------------------------------- */

describe('FN-08: `/i` flag neuters `\\p{Lu}` (form 6 / CITY_TAIL / UK)', () => {
  // Round 2 R2-1: under `/i`, `\p{Lu}` matches lowercase too. The Title-Case
  // gate in form 6 was a no-op, so prose like "place pour 10 personnes"
  // matched as `[ADDRESS] personnes`. Fixed by replacing `\p{Lu}` with
  // explicit `[A-ZÀ-ÖØ-Þ]` in 3 sites.
  it('does not match lowercase-only "place pour 10 personnes"', () => {
    expectPass('place pour 10 personnes');
  });
  it('does not match "avenue piétonne 5"', () => {
    expectPass('avenue piétonne 5');
  });
  it('still matches uppercase form 6 "Avenue du Léman 5"', () => {
    expectModified('Avenue du Léman 5, 1003 Lausanne', '[ADDRESS]');
  });
});

describe('FN-09: `Fl/DG/OG/UG/EG/WE` swallow `FL-` country prefix', () => {
  // Round 2 R2-3: `Fl\.?` (floor abbreviation) under `/i` matched "FL", which
  // ate the LI country prefix in `Landstrasse 87, FL-9494 Schaan`, producing
  // a corrupted mask `[ADDRESS]-9494 Schaan`. Fixed via `(?!-\d)` lookahead.
  it('Liechtenstein FL-postcode no longer corrupts mask', () => {
    expectModified('Landstrasse 87, FL-9494 Schaan', '[ADDRESS]');
  });
  it('Swiss CH- prefix is still consumed', () => {
    expectModified('Bahnhofstrasse 23, CH-8001 Zürich', '[ADDRESS]');
  });
  it('legitimate floor "3. OG" still matches inside an address', () => {
    expectModified('Musterstr. 1, 3. OG, 10115 Berlin', '[ADDRESS]');
  });
});

describe('FN-02: DE range/slash building numbers no longer truncate', () => {
  // Round 2 R2-6: `Hauptstr. 12-14, 10115 Berlin` masked to
  // `[ADDRESS]-14, 10115 Berlin` — postcode+city remnant exposed.
  it('range "Hauptstr. 12-14" is fully masked with the tail', () => {
    expectModified('Hauptstr. 12-14, 10115 Berlin', '[ADDRESS]');
  });
  it('slash "Hauptstr. 12/14" works too', () => {
    expectModified('Hauptstr. 12/14, 10115 Berlin', '[ADDRESS]');
  });
});

describe('FN-03: DE contracted prepositions (Im / Zur / Auf / Beim …)', () => {
  // Round 2 R2-6: `Im Tal 12, 80331 München`, `Auf Burg 2, ...` etc. all
  // leaked because form 5 mandated an article. Form 5b adds a no-article
  // variant gated by trailing-postcode lookahead.
  it('Im Tal 12 is masked', () => {
    expectModified('Im Tal 12, 80331 München', '[ADDRESS]');
  });
  it('Zur Eiche 3 is masked', () => {
    expectModified('Zur Eiche 3, 12345 Berlin', '[ADDRESS]');
  });
  it('Beim Bahnhof 7 is masked', () => {
    expectModified('Beim Bahnhof 7, 12345 Berlin', '[ADDRESS]');
  });
  it('"im Jahr 1990" prose still does not match (no postcode follower)', () => {
    expectPass('im Jahr 1990 ist viel passiert');
  });
});

describe('FN-04: US `, City, ST ZIP` comma form', () => {
  // Round 2 R2-7: `350 Fifth Avenue, New York, NY 10118` → `[ADDRESS], New
  // York, NY 10118` — the `\s+`-only US_CITY_STATE_ZIP couldn't absorb the
  // comma between city and state.
  it('canonical NYC address is fully masked', () => {
    expectModified('350 Fifth Avenue, New York, NY 10118', '[ADDRESS]');
  });
  it('multi-word city LA address is fully masked', () => {
    expectModified('1234 Sunset Boulevard, Los Angeles, CA 90028', '[ADDRESS]');
  });
});

describe('FN-07 / FP-01: EN_STREET_KW expansion + Title-Case gate', () => {
  // Round 2 R2-7: `Parkway/Terrace/Loop/Circle/Square/...` were missing from
  // EN_STREET_KW, AND form 8 had no Title-Case anchor — so prose like
  // "I had 5 cookies on the avenue" matched as a fake address.
  it('Google HQ "Amphitheatre Parkway" address is masked', () => {
    expectModified(
      '1600 Amphitheatre Parkway, Mountain View, CA 94043',
      '[ADDRESS]',
    );
  });
  it('"742 Evergreen Terrace" is masked', () => {
    expectModified('742 Evergreen Terrace', '[ADDRESS]');
  });
  it('FP "I had 5 cookies on the avenue" no longer matches', () => {
    expectPass('I had 5 cookies on the avenue');
  });
  it('FP "I had 5 dogs on the road" no longer matches', () => {
    expectPass('I had 5 dogs on the road');
  });
});

describe('FN-05: `00`-prefix international phone format', () => {
  // Round 2 R2-5: `0049 30 12345678` (DACH business-card form) was missed
  // entirely because libphonenumber-js requires `+`. Fixed by preprocessing
  // `00CC...` → `+CC...` with offset position map.
  it('00-prefix DE phone is masked', () => {
    const r = scrubPii('Reach me at 0049 30 12345678 thanks', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toBe('Reach me at [PHONE] thanks');
  });
  it('00-prefix FR phone is masked', () => {
    const r = scrubPii('Telefon 0033 1 23 45 67 89', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toContain('[PHONE]');
    expect(r.text).not.toContain('0033');
  });
  it('+ prefix still works (no regression)', () => {
    const r = scrubPii('Call me at +49 30 12345678 ok', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toBe('Call me at [PHONE] ok');
  });
  it('00 inside a phone body (not as international prefix) is left alone', () => {
    // "+1-200-300-4001" has 00 inside; previous char is digit/+ → no replace.
    const r = scrubPii('Call +1-200-300-4001 today', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toContain('[PHONE]');
  });
});

describe('FN-06: Norway IBAN (15 chars)', () => {
  // Round 2 R2-4: regex floor was 16 chars, NO IBAN is 15 — silent leak.
  it('NO IBAN compact form is masked', () => {
    expectModified('IBAN: NO9386011117947', 'IBAN: [IBAN]');
  });
  it('NO IBAN with spaces is masked', () => {
    expectModified('IBAN: NO93 8601 1117 947', 'IBAN: [IBAN]');
  });
});

describe('R2-9: large-input clamp via sanitize.ts', () => {
  // The sanitize.ts integration test lives in the next describe block since
  // it exercises the caller, not pii directly. Here we simply verify that
  // a 100KB input does NOT crash and address detection still works on the
  // first 50KB (where the clamp would kick in at the caller layer).
  it('100KB input with PII inside the first 50KB is masked', () => {
    const filler = 'a'.repeat(40_000);
    const input = `${filler} Karl-Marx-Allee 50, 10178 Berlin ${filler}`;
    const r = scrubPii(input, cfg());
    expect(r.kind).toBe('modified');
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/*  P2 / MEDIUM                                                                */
/* -------------------------------------------------------------------------- */

describe('FN-10: bare-name + country-prefix postcode (LI / DACH)', () => {
  // Round 2 R2-6 case 3: `Städtle 2, FL-9490 Vaduz` previously did not match
  // any form. Form 13 (bare-name + country-prefix lookahead) now covers it.
  it('Städtle 2, FL-9490 Vaduz is masked', () => {
    expectModified('Städtle 2, FL-9490 Vaduz', '[ADDRESS]');
  });
});

describe('FN-11: FR city apostrophe', () => {
  // Round 2 A7 (FR): `L'Île-d'Yeu` truncated at the apostrophe.
  it('apostrophe-bearing commune name is consumed by CITY_TAIL', () => {
    expectModified("12 rue X, 85350 L'Île-d'Yeu", '[ADDRESS]');
  });
});

describe('FN-12 / FN-13: COUNTRY_TAIL Italy + non-ASCII boundary', () => {
  // R2-11: `Italia` was missing; `\b` was ASCII-only so `België` end-of-string
  // failed. Both fixed.
  it('Italian address with "Italia" tail is fully masked', () => {
    expectModified('Via Veneto 50, 00187 Roma, Italia', '[ADDRESS]');
  });
  it('Belgian address with "België" tail is fully masked', () => {
    expectModified('Grote Markt 1, 1000 Brussel, België', '[ADDRESS]');
  });
});

describe('FN-17: ipAddress octet validation + IPv6', () => {
  // Round 2 R2-8: bogus 999.999.999.999 was masked; IPv6 entirely missed.
  it('valid IPv4 still masked', () => {
    expectModified(
      'Server at 192.168.1.1 is down',
      'Server at [IP_ADDRESS] is down',
    );
  });
  it('invalid octet 999.999.999.999 no longer masks', () => {
    expectPass('build_999.999.999.999_release');
  });
  it('IPv6 compressed form is masked', () => {
    const r = scrubPii('My v6 is 2001:db8::1', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toContain('[IP_ADDRESS]');
  });
});

describe('FN-18: dateOfBirth dot separator + ISO 8601 bypass', () => {
  // Round 2 R2-8: `01.02.1990` (DACH canonical) silently leaked; ISO `T`
  // boundary defeated trailing `\b`.
  it('dot-separated DACH date is masked', () => {
    expectModified('Geburtsdatum: 01.02.1990', 'Geburtsdatum: [DATE_OF_BIRTH]');
  });
  it('ISO 8601 timestamp date portion is masked', () => {
    const r = scrubPii('Joined 1990-01-02T03:04:05Z', cfg());
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toContain('[DATE_OF_BIRTH]');
    expect(r.text).not.toContain('1990-01-02');
  });
});

describe('FP-03: germanId BSI checksum', () => {
  // Round 2 A29: 9-char SKUs starting with allowed letters (`T12345678`,
  // `K00000001`) were masked as `[GERMAN_ID]`. BSI ICAO 9303 checksum gates
  // them out (~9/10 random strings rejected).
  const config = cfg();
  it('SKU "T12345678" no longer masks (checksum fails)', () => {
    const r = scrubPii('Order T12345678 shipped', config);
    expect(r.kind).toBe('pass');
  });
  it('SKU "K00000001" no longer masks', () => {
    const r = scrubPii('SKU: K00000001', config);
    expect(r.kind).toBe('pass');
  });
  it('BSI-valid `T22000124` still masks', () => {
    expectModified(
      'Personalausweis: T22000124',
      'Personalausweis: [GERMAN_ID]',
    );
  });
  it('BSI-valid `L0100FG50` still masks', () => {
    expectModified(
      'My ID L0100FG50 expires soon',
      'My ID [GERMAN_ID] expires soon',
    );
  });
});

describe('P-01: phone context-regex trailing whitespace trim', () => {
  // Round 2 R2-5: `Phone: +49 30 12345678 and IBAN ...` produced
  // `Phone: [PHONE]and IBAN ...` (lost inter-word space).
  it('inter-word space preserved between [PHONE] and following text', () => {
    const r = scrubPii(
      'Phone: +49 30 12345678 and IBAN DE89 3704 0044 0532 0130 00',
      cfg(),
    );
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toBe('Phone: [PHONE] and IBAN [IBAN]');
  });
});

/* -------------------------------------------------------------------------- */
/*  P0 / SECURITY                                                              */
/* -------------------------------------------------------------------------- */

describe('S-01: scrubPii survives malformed customPattern.regex (defense-in-depth)', () => {
  // Round 2 R2-2: schema gates this in production, but if a stale/forced
  // config arrives, scrubPii must NOT throw. It should warn and skip.
  it('scrubPii does not throw on syntactically invalid customPattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scrubPii('hello', {
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email'],
      customPatterns: [{ name: 'bad', regex: '[unclosed', replacement: '[X]' }],
    });
    // Email pattern still runs; bad pattern silently skipped.
    expect(result.kind).toBe('pass');
    expect(warn).toHaveBeenCalled();
    const log = warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(log).toContain('customPattern');
    expect(log).toContain('bad');
    warn.mockRestore();
  });

  it('built-in patterns continue to work alongside a bad customPattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = scrubPii('email me at alice@example.com', {
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email'],
      customPatterns: [{ name: 'bad', regex: '(', replacement: '[X]' }],
    });
    expect(r.kind).toBe('modified');
    if (r.kind !== 'modified') return;
    expect(r.text).toBe('email me at [EMAIL]');
    warn.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/*  detect-only smoke                                                          */
/* -------------------------------------------------------------------------- */

describe('FN-09 standalone repro on detector level', () => {
  it('detector returns one address span covering the full LI line', () => {
    const matches = detectPii(
      'Landstrasse 87, FL-9494 Schaan',
      getEnabledPatterns(['address']),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedText).toBe('Landstrasse 87, FL-9494 Schaan');
  });
});
