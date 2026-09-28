import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT_IMAGE_URL_MAX } from '@/backend/core/products/field_limits';
import { isProductImageUrl } from '@/backend/domains/products/image-url';
import { productImageUrlSchema as doorImageUrlSchema } from '@/backend/domains/products/input-schema';

import { productImageUrlSchema } from './product-image-url-schema';

const form = productImageUrlSchema({ tooLong: 'tooLong', notUrl: 'notUrl' });

function firstMessage(value: string): string | null {
  const result = form.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? '');
}

const FILE_ID = '0b5c3c1e-8a5e-4c1e-9a55-7b0f2b1d6a10';

describe('productImageUrlSchema', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('takes blank, an uploaded app path and an absolute http(s) URL', () => {
    expect(firstMessage('')).toBeNull();
    expect(
      firstMessage(`/api/app/products/images/${FILE_ID}?orgId=o1`),
    ).toBeNull();
    expect(firstMessage(' https://cdn.example.com/cat.png ')).toBeNull();
    expect(firstMessage('http://cdn.example.com/cat.png')).toBeNull();
  });

  it.each([
    ['', `/api/app/products/images/${FILE_ID}?orgId=o1`],
    ['/workspace', `/workspace/api/app/products/images/${FILE_ID}?orgId=o1`],
  ])(
    'takes the upload path the door takes under base path "%s"',
    (basePath, value) => {
      vi.stubEnv('BASE_PATH', basePath);
      expect(firstMessage(value)).toBeNull();
      expect(isProductImageUrl(value)).toBe(true);
    },
  );

  it.each([
    'example.com/cat.png',
    'cat.png',
    '//cdn.example.com/cat.png',
    'ftp://cdn.example.com/cat.png',
    'javascript:alert(1)',
    // Same-origin paths that are not an upload's: the door takes only the
    // exact path an upload returned.
    '/cat.png',
    '/images/cat.png',
    `/api/app/products/images/not-a-uuid?orgId=o1`,
    `/api/app/products/images/${FILE_ID}`,
    `/api/app/products/images/${FILE_ID}?orgId=o1#top`,
  ])('refuses %s, which the door refuses too', (value) => {
    expect(firstMessage(value)).toBe('notUrl');
    expect(doorImageUrlSchema.safeParse(value).success).toBe(false);
    expect(isProductImageUrl(value)).toBe(false);
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
