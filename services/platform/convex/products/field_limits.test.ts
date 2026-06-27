import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
  validateProductFields,
} from './field_limits';

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
  ])(
    'rejects an over-length %s with a too_long ConvexError',
    (_field, fields) => {
      let thrown: unknown;
      try {
        validateProductFields(fields);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConvexError);
      expect((thrown as ConvexError<{ code: string }>).data.code).toBe(
        'too_long',
      );
    },
  );

  it('validates per-translation fields against the base limits', () => {
    expect(() =>
      validateProductFields({
        translations: [{ name: 'x'.repeat(PRODUCT_NAME_MAX + 1) }],
      }),
    ).toThrow(ConvexError);

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
