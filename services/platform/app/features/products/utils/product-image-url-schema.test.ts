import { describe, expect, it } from 'vitest';

import { PRODUCT_IMAGE_URL_MAX } from '@/backend/core/products/field_limits';
import { productImageUrlSchema as doorImageUrlSchema } from '@/backend/domains/products/input-schema';

import { productImageUrlSchema } from './product-image-url-schema';

const form = productImageUrlSchema({ tooLong: 'tooLong', notUrl: 'notUrl' });

function firstMessage(value: string): string | null {
  const result = form.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? '');
}

describe('productImageUrlSchema', () => {
  it('takes blank, an uploaded app path and an absolute http(s) URL', () => {
    expect(firstMessage('')).toBeNull();
    expect(
      firstMessage(
        '/api/app/products/images/0b5c3c1e-8a5e-4c1e-9a55-7b0f2b1d6a10?orgId=o1',
      ),
    ).toBeNull();
    expect(firstMessage(' https://cdn.example.com/cat.png ')).toBeNull();
    expect(firstMessage('http://cdn.example.com/cat.png')).toBeNull();
  });

  it.each([
    'example.com/cat.png',
    'cat.png',
    '//cdn.example.com/cat.png',
    'ftp://cdn.example.com/cat.png',
    'javascript:alert(1)',
  ])('refuses %s, which the door refuses too', (value) => {
    expect(firstMessage(value)).toBe('notUrl');
    expect(doorImageUrlSchema.safeParse(value).success).toBe(false);
  });

  it("holds the trimmed address to the door's cap", () => {
    const base = 'https://cdn.example.com/';
    const atCap = `${base}${'a'.repeat(PRODUCT_IMAGE_URL_MAX - base.length)}`;
    expect(firstMessage(atCap)).toBeNull();
    expect(doorImageUrlSchema.safeParse(atCap).success).toBe(true);
    expect(firstMessage(`${atCap}a`)).toBe('tooLong');
    expect(doorImageUrlSchema.safeParse(`${atCap}a`).success).toBe(false);
  });
});
