import { describe, expect, it } from 'vitest';

import { productNumberSchema } from './product-number-schema';

const stock = productNumberSchema({
  number: 'number',
  nonNegative: 'nonNegative',
  tooLarge: 'tooLarge',
  integer: 'integer',
});
const price = productNumberSchema({
  number: 'number',
  nonNegative: 'nonNegative',
  tooLarge: 'tooLarge',
});

function firstMessage(schema: typeof stock, value: string): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? '');
}

describe('productNumberSchema', () => {
  it('takes blank as not given and a plain non-negative amount', () => {
    expect(firstMessage(price, '')).toBeNull();
    expect(firstMessage(price, ' 12.50 ')).toBeNull();
    expect(firstMessage(stock, '0')).toBeNull();
    expect(firstMessage(stock, String(Number.MAX_SAFE_INTEGER))).toBeNull();
  });

  it.each([
    ['abc', 'number'],
    ['-0.01', 'nonNegative'],
    ['1e20', 'tooLarge'],
    ['99999999999999999999', 'tooLarge'],
  ])('refuses %s as %s', (value, message) => {
    expect(firstMessage(price, value)).toBe(message);
  });

  it('holds a count to whole numbers and an amount not', () => {
    expect(firstMessage(stock, '1.5')).toBe('integer');
    expect(firstMessage(price, '1.5')).toBeNull();
  });
});
