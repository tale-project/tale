import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  ISO_4217_CURRENCIES,
  isIso4217Currency,
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
  validateProductFields,
} from './field_limits';

/**
 * The currency vocabulary the door, the dialogs and the OpenAPI document
 * share. The regression under test: `currency` was any string of at most
 * three characters, so `ZZZ`, `123` and `$` were stored as ISO 4217 codes.
 */
describe('isIso4217Currency', () => {
  it('knows the runtime’s ICU currency list, uppercase', () => {
    expect(ISO_4217_CURRENCIES.size).toBeGreaterThan(100);
    for (const code of ISO_4217_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it.each(['USD', 'EUR', 'CHF', 'usd', 'Gbp'])('accepts %s', (code) => {
    expect(isIso4217Currency(code)).toBe(true);
  });

  it.each(['ZZZ', '123', '$', '', 'US', 'USDD'])('refuses %j', (code) => {
    expect(isIso4217Currency(code)).toBe(false);
  });
});

describe('validateProductFields', () => {
  it('accepts fields at their maximum length', () => {
    expect(() =>
      validateProductFields({
        name: 'a'.repeat(PRODUCT_NAME_MAX),
        description: 'b'.repeat(PRODUCT_DESCRIPTION_MAX),
        category: 'c'.repeat(PRODUCT_CATEGORY_MAX),
        currency: 'USD',
        imageUrl:
          'https://example.com/' + 'd'.repeat(PRODUCT_IMAGE_URL_MAX - 20),
      }),
    ).not.toThrow();
  });

  it('accepts an empty/undefined field set', () => {
    expect(() => validateProductFields({})).not.toThrow();
  });

  it.each([
    ['name', { name: 'a'.repeat(PRODUCT_NAME_MAX + 1) }],
    ['description', { description: 'b'.repeat(PRODUCT_DESCRIPTION_MAX + 1) }],
    ['category', { category: 'c'.repeat(PRODUCT_CATEGORY_MAX + 1) }],
    ['currency', { currency: 'd'.repeat(PRODUCT_CURRENCY_MAX + 1) }],
    ['imageUrl', { imageUrl: 'e'.repeat(PRODUCT_IMAGE_URL_MAX + 1) }],
  ])('rejects an over-length %s with a too_long AppError', (_field, fields) => {
    let thrown: unknown;
    try {
      validateProductFields(fields);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError<{ code: string }>).data.code).toBe('too_long');
  });

  it('validates per-translation fields against the base limits', () => {
    expect(() =>
      validateProductFields({
        translations: [{ name: 'x'.repeat(PRODUCT_NAME_MAX + 1) }],
      }),
    ).toThrow(AppError);

    expect(() =>
      validateProductFields({
        translations: [
          null,
          undefined,
          { name: 'ok', description: 'still ok', category: 'fine' },
        ],
      }),
    ).not.toThrow();
  });
});
