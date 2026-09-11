// @vitest-environment node

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  apiNotFound,
  backendSecureHeaders,
  nulUrlGuard,
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

describe('apiNotFound', () => {
  it('answers the JSON envelope for an unrouted API path', async () => {
    const res = await app().request('http://localhost/api/v2/anything');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
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
