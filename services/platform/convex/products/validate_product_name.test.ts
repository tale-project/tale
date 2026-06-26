import { describe, expect, it } from 'vitest';

import {
  PRODUCT_NAME_MAX_LENGTH,
  validateProductName,
} from './validate_product_name';

describe('validateProductName', () => {
  it('returns the trimmed name for valid input', () => {
    expect(validateProductName('  Widget  ')).toBe('Widget');
    expect(validateProductName('Widget')).toBe('Widget');
  });

  it('throws on an empty name', () => {
    expect(() => validateProductName('')).toThrow('Product name is required');
  });

  it('throws on a whitespace-only name', () => {
    expect(() => validateProductName('   ')).toThrow(
      'Product name is required',
    );
    expect(() => validateProductName('\t\n ')).toThrow(
      'Product name is required',
    );
  });

  it('accepts a name at the max length', () => {
    const name = 'a'.repeat(PRODUCT_NAME_MAX_LENGTH);
    expect(validateProductName(name)).toBe(name);
  });

  it('throws when the trimmed name exceeds the max length', () => {
    const name = 'a'.repeat(PRODUCT_NAME_MAX_LENGTH + 1);
    expect(() => validateProductName(name)).toThrow(
      `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters`,
    );
  });

  it('measures length after trimming surrounding whitespace', () => {
    const name = `  ${'a'.repeat(PRODUCT_NAME_MAX_LENGTH)}  `;
    expect(validateProductName(name)).toBe('a'.repeat(PRODUCT_NAME_MAX_LENGTH));
  });
});
