import { afterEach, describe, expect, it, vi } from 'vitest';

import { iso4217Currencies, isIso4217Currency } from './field_limits';

/**
 * The currency vocabulary the door, the dialogs and the OpenAPI document
 * share. The regression under test: `currency` was any string of at most
 * three characters, so `ZZZ`, `123` and `$` were stored as ISO 4217 codes.
 */
describe('isIso4217Currency [PROD-R3]', () => {
  it('knows the runtime’s ICU currency list, uppercase', () => {
    const known = iso4217Currencies();
    expect(known).not.toBeNull();
    expect(known?.size).toBeGreaterThan(100);
    for (const code of known ?? []) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it.each(['USD', 'EUR', 'CHF', 'usd', 'Gbp'])('accepts %s', (code) => {
    expect(isIso4217Currency(code)).toBe(true);
  });

  it.each(['ZZZ', '123', '$', '', 'US', 'USDD'])('refuses %j', (code) => {
    expect(isIso4217Currency(code)).toBe(false);
  });

  // The list used to be read at module load, so a browser without
  // `Intl.supportedValuesOf` (Safari < 15.4) threw before the import
  // dialogs could even render. It is asked lazily now, and where the
  // runtime cannot answer any three letters pass (the server still judges).
  describe('where the runtime has no Intl.supportedValuesOf', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it('loads, warns once, and accepts any three-letter code', async () => {
      vi.resetModules();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
        throw new TypeError('Intl.supportedValuesOf is not a function');
      });
      const fresh = await import('./field_limits');
      expect(fresh.iso4217Currencies()).toBeNull();
      expect(fresh.isIso4217Currency('ZZZ')).toBe(true);
      expect(fresh.isIso4217Currency('usd')).toBe(true);
      expect(fresh.isIso4217Currency('US')).toBe(false);
      expect(fresh.isIso4217Currency('123')).toBe(false);
      expect(fresh.isIso4217Currency('USDD')).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
