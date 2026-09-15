import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productImageUrl } from '../domains/products/images.ts';
import {
  productRestImageSchema,
  validateRestProductImage,
} from './product-images.ts';

const id = '05b12345-1020-4000-8000-123456789abc';
const scope = { organizationId: 'org-1', userId: 'u1', role: 'admin' };
const request = new Request('http://backend:3005/products');

describe('REST managed product image validation', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com');
    vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://other.example.com');
    vi.stubEnv('BASE_PATH', '/workspace');
    vi.stubEnv('TALE_ALLOW_PRIVATE_CRAWL_HOSTS', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes configured origin aliases to one base-path-aware binding', () => {
    const path = productImageUrl(scope.organizationId, id);
    const schema = productRestImageSchema(request, scope.organizationId);
    for (const origin of [
      'https://tale.example.com',
      'https://other.example.com',
    ]) {
      expect(schema.parse(`${origin}${path}`)).toBe(path);
    }
  });

  it('refuses forged managed URLs and keeps the public pasted-URL policy', () => {
    const path = productImageUrl(scope.organizationId, id);
    const schema = productRestImageSchema(request, scope.organizationId);
    for (const value of [
      path,
      `https://tale.example.com${path.replace('org-1', 'org-2')}`,
      `https://tale.example.com${path}#fragment`,
      `https://tale.example.com${path}&extra=1`,
      `https://user:pass@tale.example.com${path}`,
      `http://127.0.0.1${path}`,
      `http://169.254.169.254${path}`,
    ])
      expect(schema.safeParse(value).success).toBe(false);
    expect(schema.parse('https://cdn.example.com/image.png')).toBe(
      'https://cdn.example.com/image.png',
    );
    expect(schema.parse(null)).toBeNull();
  });

  it('answers an opaque registered-file refusal without writing a product', async () => {
    const tx = Object.assign(
      vi.fn(async () => []),
      { unsafe: vi.fn((value: string) => value) },
    );
    await expect(
      validateRestProductImage(
        tx as never,
        scope,
        productImageUrl(scope.organizationId, id),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND', status: 404 });
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
