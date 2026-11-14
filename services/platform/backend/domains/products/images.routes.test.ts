import type { Context } from 'hono';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
const {
  uploadProductImage,
  readProductImage,
  openFileContent,
  checkUserRateLimit,
} = vi.hoisted(() => ({
  uploadProductImage: vi.fn(),
  readProductImage: vi.fn(),
  openFileContent: vi.fn(),
  checkUserRateLimit: vi.fn(),
}));
vi.mock('./images.ts', async (load) => ({
  ...(await load<typeof import('./images.ts')>()),
  uploadProductImage,
  readProductImage,
}));
vi.mock('../files/service.ts', async (load) => ({
  ...(await load<typeof import('../files/service.ts')>()),
  openFileContent,
}));
vi.mock('../../lib/rate-limit.ts', async (load) => ({
  ...(await load<typeof import('../../lib/rate-limit.ts')>()),
  checkUserRateLimit,
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { createProductRoutes } from './routes.ts';
const app = () => createProductRoutes({ sql: {} as never, auth: {} as never });
describe('product image byte routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkUserRateLimit.mockResolvedValue(undefined);
  });
  it('accepts a bounded upload and returns the registered stable URL', async () => {
    uploadProductImage.mockResolvedValue({
      imageUrl: '/api/app/products/images/f1?orgId=o1',
    });
    const response = await app().request('/images?orgId=o1', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imageUrl: '/api/app/products/images/f1?orgId=o1',
    });
    expect(uploadProductImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', userId: 'u1' }),
      new Uint8Array([1, 2, 3]),
    );
  });
  it('rejects an oversized declared body before image storage', async () => {
    const response = await app().request('/images?orgId=o1', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) },
    });
    expect(response.status).toBe(413);
    expect(uploadProductImage).not.toHaveBeenCalled();
  });
  it('streams authorized SVG under a sandbox without disclosing a presigned URL', async () => {
    readProductImage.mockResolvedValue({
      storageRef: 's3:o1/image',
      contentType: 'image/svg+xml',
    });
    openFileContent.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'image/svg+xml' }),
      body: new Response('<svg/>').body,
    });
    const response = await app().request('/images/f1?orgId=o1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<svg/>');
    expect(response.headers.get('content-security-policy')).toContain(
      'sandbox',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('location')).toBe(false);
  });
  describe('variants', () => {
    async function original(width: number): Promise<Uint8Array<ArrayBuffer>> {
      return Uint8Array.from(
        await sharp({
          create: {
            width,
            height: width,
            channels: 3,
            background: { r: 10, g: 20, b: 30 },
          },
        })
          .png()
          .toBuffer(),
      );
    }
    function storedAs(bytes: Uint8Array<ArrayBuffer>) {
      readProductImage.mockResolvedValue({
        storageRef: 's3:o1/image',
        contentType: 'image/png',
      });
      openFileContent.mockResolvedValue({
        status: 200,
        headers: new Headers({
          'content-type': 'image/png',
          'content-length': String(bytes.byteLength),
          etag: '"original"',
        }),
        body: new Response(bytes).body,
      });
    }

    it('serves the card variant at 256 px as a cacheable WebP', async () => {
      storedAs(await original(1200));
      const response = await app().request('/images/f1?orgId=o1&variant=card');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('cache-control')).toBe(
        'private, max-age=3600',
      );
      expect(response.headers.has('etag')).toBe(false);
      const meta = await sharp(
        new Uint8Array(await response.arrayBuffer()),
      ).metadata();
      expect(meta.width).toBe(256);
      expect(meta.format).toBe('webp');
    });

    it('serves the list variant at 160 px', async () => {
      storedAs(await original(1200));
      const response = await app().request('/images/f1?orgId=o1&variant=list');
      const meta = await sharp(
        new Uint8Array(await response.arrayBuffer()),
      ).metadata();
      expect(meta.width).toBe(160);
    });

    it('serves the original, uncached, when no variant is asked for', async () => {
      const bytes = await original(1200);
      storedAs(bytes);
      const response = await app().request('/images/f1?orgId=o1');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it('serves an SVG unchanged even when a variant is asked for', async () => {
      readProductImage.mockResolvedValue({
        storageRef: 's3:o1/image',
        contentType: 'image/svg+xml',
      });
      openFileContent.mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: new Response('<svg/>').body,
      });
      const response = await app().request('/images/f1?orgId=o1&variant=card');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe('<svg/>');
    });

    it('serves the original when the stored bytes cannot be decoded', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storedAs(new TextEncoder().encode('legacy, not decodable'));
      const response = await app().request('/images/f1?orgId=o1&variant=list');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe('legacy, not decodable');
      warn.mockRestore();
    });
  });
});
