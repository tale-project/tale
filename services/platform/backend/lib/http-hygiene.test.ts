// @vitest-environment node

import { createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  apiKeyHeaderGuard,
  apiNotFound,
  backendSecureHeaders,
  nulUrlGuard,
  apiPathWithoutTrailingSlash,
  BodilessAwareResponse,
  uriLengthGuard,
} from './http-hygiene.ts';

/**
 * The hygiene every backend response shares. The regressions under test:
 * a `%00` in any `/api/v1` path or query reached Postgres and answered a
 * text/plain 500; a mistyped prefix (`/api/v2/…`) answered Hono's
 * text/plain 404; and no backend response carried the transport-security
 * headers the app tier emits, because the proxy hands `/api/*` straight to
 * the backend.
 */

function app(siteUrl?: string) {
  const hono = new Hono();
  hono.notFound(apiNotFound);
  hono.use(nulUrlGuard());
  hono.use(backendSecureHeaders(siteUrl));
  hono.get('/api/v1/documents/:id', (c) => c.json({ id: c.req.param('id') }));
  hono.get('/api/v1/documents', (c) => c.json({ q: c.req.query('source') }));
  return hono;
}

describe('nulUrlGuard', () => {
  it.each([
    '/api/v1/documents/a%00b',
    '/api/v1/documents?source=a%00b',
    '/api/v1/documents/a%00b?x=1',
  ])('answers 400 INVALID_URL for %s', async (path) => {
    const res = await app().request(`http://localhost${path}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ code: 'INVALID_URL' });
  });

  it('lets every other request through untouched', async () => {
    const res = await app().request(
      'http://localhost/api/v1/documents/a%20b?source=x%2Fy',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a b' });
  });
});

describe('apiKeyHeaderGuard', () => {
  const guarded = new Hono();
  guarded.use(apiKeyHeaderGuard(['x-api-key']));
  // Stands in for the auth mount and the session-gated app door: with the
  // plugin honouring the header, either would have answered as the key
  // holder.
  guarded.get('/api/auth/get-session', (c) =>
    c.json({ user: 'would be minted' }),
  );
  guarded.post('/api/auth/api-key/create', (c) => c.json({ key: 'minted' }));

  it('refuses a request that carries the plugin header, before any door', async () => {
    const res = await guarded.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { 'x-api-key': 'tale_leaked' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({
      error:
        'The "x-api-key" header is not accepted — send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
      code: 'UNAUTHORIZED',
    });
  });

  it('refuses the header whatever its case and even when empty', async () => {
    const variants: Record<string, string>[] = [
      { 'X-Api-Key': 'tale_leaked' },
      { 'x-api-key': '' },
    ];
    for (const headers of variants) {
      const res = await guarded.request('/api/auth/get-session', { headers });
      expect(res.status).toBe(401);
    }
  });

  it('is transparent to a request that does not carry it', async () => {
    const res = await guarded.request('/api/auth/get-session', {
      headers: { authorization: 'Bearer tale_key' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 'would be minted' });
  });
});

describe('apiNotFound', () => {
  it('answers the JSON envelope for an unrouted API path', async () => {
    const res = await app().request('http://localhost/api/v2/anything');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the plain 404 outside the API prefix', async () => {
    const res = await app().request('http://localhost/elsewhere');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });
});

describe('backendSecureHeaders', () => {
  it('stamps the transport headers on a response, HSTS only for an https site', async () => {
    const secure = await app('https://tale.example').request(
      'http://localhost/api/v1/documents/1',
    );
    expect(secure.headers.get('strict-transport-security')).toBe(
      'max-age=15552000',
    );
    expect(secure.headers.get('x-content-type-options')).toBe('nosniff');
    expect(secure.headers.get('x-frame-options')).toBe('DENY');
    expect(secure.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(secure.headers.get('content-security-policy')).toBeNull();
    expect(secure.headers.get('cross-origin-opener-policy')).toBeNull();

    const plain = await app('http://localhost:3005').request(
      'http://localhost/api/v1/documents/1',
    );
    expect(plain.headers.get('strict-transport-security')).toBeNull();
    expect(plain.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('stamps them on a refusal too', async () => {
    const res = await app('https://tale.example').request(
      'http://localhost/api/v2/nope',
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('uriLengthGuard', () => {
  const guarded = new Hono();
  guarded.use(uriLengthGuard());
  guarded.get('/api/v1/contacts', (c) => c.json({ ok: true }));

  it('lets a request target up to the budget through', async () => {
    const query = 'q='.padEnd(32 * 1024 - '/api/v1/contacts?'.length, 'a');
    const res = await guarded.request(
      `http://localhost/api/v1/contacts?${query}`,
    );
    expect(res.status).toBe(200);
  });

  it('answers 414 in the envelope one byte over it, before any route runs', async () => {
    const query = 'q='.padEnd(32 * 1024 - '/api/v1/contacts?'.length + 1, 'a');
    const res = await guarded.request(
      `http://localhost/api/v1/contacts?${query}`,
    );
    expect(res.status).toBe(414);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: 'The request URL exceeds 32 KiB (path and query)',
      code: 'URI_TOO_LONG',
    });
  });
});

describe('apiPathWithoutTrailingSlash', () => {
  const path = (url: string) => apiPathWithoutTrailingSlash(new Request(url));

  it('drops one trailing slash under /api/v1/', () => {
    expect(path('http://localhost/api/v1/contacts/')).toBe('/api/v1/contacts');
    expect(path('http://localhost/api/v1/contacts/abc/?limit=2')).toBe(
      '/api/v1/contacts/abc',
    );
  });

  it('leaves the prefix, a doubled slash and every other path alone', () => {
    expect(path('http://localhost/api/v1/')).toBe('/api/v1/');
    expect(path('http://localhost/api/v1/contacts//')).toBe(
      '/api/v1/contacts//',
    );
    expect(path('http://localhost/api/v1/contacts')).toBe('/api/v1/contacts');
    expect(path('http://localhost/api/app/contacts/')).toBe(
      '/api/app/contacts/',
    );
    expect(path('http://localhost/dav/org/documents/')).toBe(
      '/dav/org/documents/',
    );
  });
});

describe('BodilessAwareResponse', () => {
  it('drops the content headers the adapter stamps on a 204, and nothing else', async () => {
    const hono = new Hono();
    hono.delete('/thing', (c) => c.body(null, 204));
    hono.get('/thing', (c) => c.json({ ok: true }));
    const server = createAdaptorServer({
      fetch: hono.fetch,
      serverOptions: { ServerResponse: BodilessAwareResponse },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('no port');
      }
      const base = `http://127.0.0.1:${address.port}`;
      const gone = await fetch(`${base}/thing`, { method: 'DELETE' });
      expect(gone.status).toBe(204);
      expect(gone.headers.get('content-type')).toBeNull();
      expect(gone.headers.get('content-length')).toBeNull();
      const read = await fetch(`${base}/thing`);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toContain('application/json');
      expect(await read.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('keeps a bodiless 416 free of the adapter default type, with its length and range', async () => {
    const hono = new Hono();
    hono.get(
      '/blob',
      () =>
        new Response(null, {
          status: 416,
          headers: {
            'content-range': 'bytes */29',
            'content-length': '0',
            'accept-ranges': 'bytes',
          },
        }),
    );
    const server = createAdaptorServer({
      fetch: hono.fetch,
      serverOptions: { ServerResponse: BodilessAwareResponse },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('no port');
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/blob`, {
        headers: { range: 'bytes=29-' },
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-type')).toBeNull();
      expect(res.headers.get('content-length')).toBe('0');
      expect(res.headers.get('content-range')).toBe('bytes */29');
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(await res.text()).toBe('');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
