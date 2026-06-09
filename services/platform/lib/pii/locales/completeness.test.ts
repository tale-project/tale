import { describe, expect, it } from 'vitest';

import { SUPPORTED_DATASET_LOCALES } from '../../shared/constants/dataset-locales';
import { ALL_LOCALES } from './data';

/**
 * Production safety net for the PII locale registry: guarantees full locale
 * coverage and that every national-ID spec references a checksum builder that
 * actually exists. National-ID specs are NOT auto-generated — they run regex
 * against untrusted user content, so wrong patterns/checksums are a privacy and
 * correctness hazard. This test locks the curated coverage in place.
 */

// The closed set of checksum algorithms with a builder in
// `patterns/national-ids/builders.ts` (mirrors the union in `locales/types.ts`).
const KNOWN_CHECKSUMS = new Set([
  'ar-cuil',
  'au-tfn',
  'be-nrn',
  'br-cnpj',
  'cz-rc',
  'de-steuer-id',
  'dk-cpr',
  'ean13',
  'es-dni',
  'es-nie',
  'fr-nir',
  'hk-hkid',
  'icao9303',
  'ie-mod23',
  'il-teudat-zehut',
  'it-codice-fiscale',
  'jp-mynumber',
  'kr-rrn',
  'luhn',
  'mod11-2-cn',
  'mod11-bsn',
  'mod11-cpf',
  'mx-curp',
  'my-mykad',
  'nz-ird',
  'pesel-mod10',
  'pt-nif',
  'ro-cnp',
  'ru-inn-12',
  'se-personnummer',
  'sg-nric',
  'tr-tckn',
  'verhoeff',
]);

describe('PII locale registry completeness', () => {
  const byLocale = new Map(ALL_LOCALES.map((l) => [l.locale, l]));

  it('covers every supported dataset locale (and no extras)', () => {
    const present = new Set(ALL_LOCALES.map((l) => l.locale));
    for (const loc of SUPPORTED_DATASET_LOCALES) {
      expect(present.has(loc), `missing PII locale: ${loc}`).toBe(true);
    }
    expect(present.size).toBe(SUPPORTED_DATASET_LOCALES.length);
  });

  it('every locale declares required detection vocabulary', () => {
    for (const cfg of ALL_LOCALES) {
      expect(
        cfg.phoneContextKeywords.length,
        `${cfg.locale} phone`,
      ).toBeGreaterThan(0);
      expect(
        cfg.cvcContextKeywords.length,
        `${cfg.locale} cvc`,
      ).toBeGreaterThan(0);
      expect(
        cfg.address.forms.length,
        `${cfg.locale} address forms`,
      ).toBeGreaterThan(0);
      expect(Array.isArray(cfg.nationalIds), `${cfg.locale} nationalIds`).toBe(
        true,
      );
    }
  });

  it('every locale has date-of-birth vocabulary', () => {
    for (const cfg of ALL_LOCALES) {
      expect(cfg.dateOfBirth, `${cfg.locale} dateOfBirth`).toBeDefined();
    }
  });

  it('every national-ID spec references a known checksum builder', () => {
    for (const cfg of ALL_LOCALES) {
      for (const spec of cfg.nationalIds) {
        if (spec.checksum === undefined) continue;
        expect(
          KNOWN_CHECKSUMS.has(spec.checksum),
          `${cfg.locale}/${spec.id}: unknown checksum "${spec.checksum}"`,
        ).toBe(true);
      }
    }
  });

  it('every national-ID regex compiles', () => {
    for (const cfg of ALL_LOCALES) {
      for (const spec of cfg.nationalIds) {
        expect(
          () => new RegExp(spec.pattern, 'g'),
          `${cfg.locale}/${spec.id}`,
        ).not.toThrow();
      }
    }
  });

  it('exposes a healthy national-ID footprint across the registry', () => {
    const total = ALL_LOCALES.reduce((n, l) => n + l.nationalIds.length, 0);
    expect(total).toBeGreaterThan(20);
    expect(byLocale.has('de')).toBe(true);
  });
});
