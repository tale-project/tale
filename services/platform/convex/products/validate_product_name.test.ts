import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_NAME_MAX_LENGTH,
  validateProductName,
} from './validate_product_name';

/**
 * Assert that `fn` throws a `ConvexError` whose `data.code` is `'validation'`
 * (so the REST wrapper maps it to a 400) and whose `data.message` matches.
 */
function expectValidationError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ConvexError);
  expect(
    (thrown as ConvexError<{ code: string; message: string }>).data,
  ).toEqual({ code: 'validation', message });
}

describe('validateProductName', () => {
  it('returns the trimmed name for valid input', () => {
    expect(validateProductName('  Widget  ')).toBe('Widget');
    expect(validateProductName('Widget')).toBe('Widget');
  });

  it('throws a validation ConvexError on an empty name', () => {
    expectValidationError(
      () => validateProductName(''),
      'Product name is required',
    );
  });

  it('throws a validation ConvexError on a whitespace-only name', () => {
    expectValidationError(
      () => validateProductName('   '),
      'Product name is required',
    );
    expectValidationError(
      () => validateProductName('\t\n '),
      'Product name is required',
    );
  });

  it('accepts a name at the max length', () => {
    const name = 'a'.repeat(PRODUCT_NAME_MAX_LENGTH);
    expect(validateProductName(name)).toBe(name);
  });

  it('throws a validation ConvexError when the trimmed name exceeds the max length', () => {
    const name = 'a'.repeat(PRODUCT_NAME_MAX_LENGTH + 1);
    expectValidationError(
      () => validateProductName(name),
      `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters`,
    );
  });

  it('measures length after trimming surrounding whitespace', () => {
    const name = `  ${'a'.repeat(PRODUCT_NAME_MAX_LENGTH)}  `;
    expect(validateProductName(name)).toBe('a'.repeat(PRODUCT_NAME_MAX_LENGTH));
  });
});
