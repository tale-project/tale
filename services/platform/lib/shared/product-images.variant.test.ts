import { describe, expect, it } from 'vitest';

import {
  buildProductImageUrl,
  productImageVariantUrl,
} from './product-images.ts';

const fileId = '05b12345-1020-4000-8000-123456789abc';

describe('productImageVariantUrl', () => {
  it('adds the variant to the canonical managed URL', () => {
    const url = buildProductImageUrl('org-1', fileId, '/base');
    expect(productImageVariantUrl(url, 'list')).toBe(`${url}&variant=list`);
    expect(productImageVariantUrl(url, 'card')).toBe(`${url}&variant=card`);
  });

  it('leaves an external link unchanged', () => {
    const url = 'https://example.com/image.jpg';
    expect(productImageVariantUrl(url, 'card')).toBe(url);
  });

  it('leaves a non-canonical app path unchanged', () => {
    const url = `/api/app/products/images/${fileId}?orgId=org-1&x=1`;
    expect(productImageVariantUrl(url, 'list')).toBe(url);
  });
});
