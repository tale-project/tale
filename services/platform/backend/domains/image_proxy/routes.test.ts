// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import type { SessionBundle } from '../../auth/session.ts';
import { RateLimitExceededError } from '../../lib/rate-limit.ts';

const { checkUserRateLimit } = vi.hoisted(() => ({
  checkUserRateLimit: vi.fn(),
}));

vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkUserRateLimit,
}));

const { createImageProxyRoutes } = await import('./routes.ts');
const { ImageProxyError } = await import('./service.ts');

const SIGNED_IN: SessionBundle = {
  user: { id: 'u1', email: 'u@example.test', name: 'User' },
  session: { id: 's1', activeOrganizationId: 'org-1' },
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function app(
  session: SessionBundle | null,
  fetchImage = vi.fn(async (_target: URL) => ({
    bytes: PNG_BYTES,
    contentType: 'image/png',
  })),
) {
  return {
    fetchImage,
    routes: createImageProxyRoutes({
      sql: {} as never,
      auth: { api: { getSession: async () => session } } as unknown as Auth,
      fetchImage,
    }),
  };
}

const TARGET = 'https://mail.example.com/logo.png';
const PATH = `/?url=${encodeURIComponent(btoa(TARGET))}`;

beforeEach(() => {
  checkUserRateLimit.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/image-proxy', () => {
  it('refuses a request with no session, before fetching anything', async () => {
    const { routes, fetchImage } = app(null);

    const res = await routes.request(PATH);

    expect(res.status).toBe(401);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('serves the image under its detected type, inert and uncached by shared caches', async () => {
    const { routes, fetchImage } = app(SIGNED_IN);

    const res = await routes.request(PATH);

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    );
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(fetchImage.mock.calls[0]?.[0]).toEqual(new URL(TARGET));
    expect(checkUserRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'security:image-proxy',
      'u1',
    );
  });

  it('answers a refusal in the coded envelope, never cached', async () => {
    const { routes } = app(
      SIGNED_IN,
      vi.fn(async () => {
        throw new ImageProxyError('NOT_AN_IMAGE', 415, 'not an image');
      }),
    );

    const res = await routes.request(PATH);

    expect(res.status).toBe(415);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: 'not an image',
      code: 'NOT_AN_IMAGE',
    });
  });

  it('answers a malformed url parameter as 400 without fetching', async () => {
    const { routes, fetchImage } = app(SIGNED_IN);

    const res = await routes.request('/?url=not-base64%25');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_IMAGE_URL' });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('answers a spent budget with the 429 every door speaks', async () => {
    checkUserRateLimit.mockRejectedValue(
      new RateLimitExceededError('Rate limit exceeded', 2_500),
    );
    const { routes, fetchImage } = app(SIGNED_IN);

    const res = await routes.request(PATH);

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
