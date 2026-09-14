import type { Context } from 'hono';
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
});
