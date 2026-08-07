import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_NAME_MAX_LENGTH,
  validateProductName,
} from './validate_product_name';

/**
 * Assert that `fn` throws a `ConvexError` whose `data.code` is `'validation'`
 * (so the REST wrapper maps it to a 400), whose `data.message` matches, and
 * which carries the `userMessage` the toast layer is allowed to render
 * verbatim (see `convexUserMessage`). Asserting `userMessage` here rather than
 * ignoring it keeps the two apart: `message` stays the developer-facing string
 * the REST envelope reports, `userMessage` is the copy a user actually reads.
 */
function expectValidationError(
  fn: () => unknown,
  message: string,
  userMessage: string,
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ConvexError);
  expect(
    (
      thrown as ConvexError<{
        code: string;
        message: string;
        userMessage: string;
      }>
    ).data,
  ).toEqual({ code: 'validation', message, userMessage });
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
      'Product name is required.',
    );
  });

  it('throws a validation ConvexError on a whitespace-only name', () => {
    expectValidationError(
      () => validateProductName('   '),
      'Product name is required',
      'Product name is required.',
    );
    expectValidationError(
      () => validateProductName('\t\n '),
      'Product name is required',
      'Product name is required.',
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
      `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters.`,
    );
  });

  it('measures length after trimming surrounding whitespace', () => {
    const name = `  ${'a'.repeat(PRODUCT_NAME_MAX_LENGTH)}  `;
    expect(validateProductName(name)).toBe('a'.repeat(PRODUCT_NAME_MAX_LENGTH));
  });
});
