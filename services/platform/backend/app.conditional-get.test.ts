// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

/**
 * The validated-read contract as the REAL app wires it — the middleware
 * sits in `app.ts` ahead of both doors, and the REST door's own `no-store`
 * default is inner to it. A synthetic router proves the middleware; only
 * `createApp` proves the order, and a reorder would silently put every
 * `/api/v1` read back on `no-store` with no 304.
 */

const GOOD_KEY = 'tale_good';

/** The door's membership and budget reads, and empty tables for the rest. */
function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve([{ organizationId: 'org-1', role: 'member' }]);
    }
    if (text.includes('FROM "member" m JOIN "organization" o')) {
      return Promise.resolve([
        { organizationId: 'org-1', role: 'member', name: 'Org', slug: 'org-1' },
      ]);
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('FROM "member" WHERE "organizationId"')) {
      return Promise.resolve([
        {
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'member',
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    begin: (
      options: string | ((tx: unknown) => Promise<unknown>),
      callback?: (tx: unknown) => Promise<unknown>,
    ) => (typeof options === 'function' ? options(sql) : callback?.(sql)),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

/** `GOOD_KEY` in the api-key header is user-1's session; anything else is
 * no session — the shape the door and the session gate both read. */
function fakeAuth(): Auth {
  const getSession = vi.fn(({ headers }: { headers: Headers }) =>
    Promise.resolve(
      headers.get('x-api-key') === GOOD_KEY ||
        headers.get('cookie') === 'tale.session=good'
        ? {
            user: { id: 'user-1', email: 'user@example.com', name: 'U' },
            session: { id: 's-1', activeOrganizationId: 'org-1' },
          }
        : null,
    ),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return {
    api: { getSession },
    options: { baseURL: 'http://localhost' },
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as Auth;
}

const app = () => createApp({ sql: fakeSql(), auth: fakeAuth() });
const bearer = { authorization: `Bearer ${GOOD_KEY}` };

describe('validated reads through the real app', () => {
  it('replaces the REST door’s no-store with a validator and private, no-cache', async () => {
    const res = await app().request(
      'http://localhost/api/v1/contacts?limit=1',
      {
        headers: bearer,
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-request-id')).not.toBeNull();
  });

  it('answers a bodiless 304 to the tag it issued, request id and transport headers intact', async () => {
    const first = await app().request(
      'http://localhost/api/v1/contacts?limit=1',
      { headers: bearer },
    );
    const etag = first.headers.get('etag') ?? '';
    const res = await app().request(
      'http://localhost/api/v1/contacts?limit=1',
      {
        headers: { ...bearer, 'if-none-match': etag },
      },
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-request-id')).not.toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('carries the validator on HEAD and answers its 304 too', async () => {
    const head = await app().request(
      'http://localhost/api/v1/contacts?limit=1',
      { method: 'HEAD', headers: bearer },
    );
    expect(head.status).toBe(200);
    const etag = head.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    expect(await head.text()).toBe('');
    const again = await app().request(
      'http://localhost/api/v1/contacts?limit=1',
      { method: 'HEAD', headers: { ...bearer, 'if-none-match': etag } },
    );
    expect(again.status).toBe(304);
  });

  it('leaves a refusal on no-store, uncached', async () => {
    const res = await app().request('http://localhost/api/v1/contacts?limit=1');
    expect(res.status).toBe(401);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  /**
   * The refusals answered AHEAD of the door — the x-api-key guard, the URL
   * budget, the NUL guard — through the real wiring. The regression
   * (2026-09-12 round-d evaluation, S3-2/S3-3): the door's stamper ran
   * behind these guards, so their answers were the only enveloped ones on
   * the surface without `X-Tale-Api-Version` or `Cache-Control`, and the
   * 414 alone omitted the `requestId` the Error schema promises of it.
   */
  it.each([
    [
      'a key in x-api-key',
      'http://localhost/api/v1/me',
      { headers: { ...bearer, 'x-api-key': 'tale_leaked' } },
      401,
      'UNAUTHORIZED',
    ],
    [
      'a URL over 32 KiB',
      `http://localhost/api/v1/contacts?q=${'a'.repeat(32 * 1024)}`,
      { headers: bearer },
      414,
      'URI_TOO_LONG',
    ],
    [
      'a NUL in the URL',
      'http://localhost/api/v1/documents/a%00b',
      { headers: bearer },
      400,
      'INVALID_URL',
    ],
  ])(
    'answers %s with the contract headers the door promises of every answer',
    async (_name, url, init, status, code) => {
      const res = await app().request(url, init);
      expect(res.status).toBe(status);
      expect(res.headers.get('x-tale-api-version')).toMatch(/^\d+\.\d+\.\d+$/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const id = res.headers.get('x-request-id');
      expect(id).not.toBeNull();
      const body: { code: string; requestId?: string } = await res.json();
      expect(body.code).toBe(code);
      if (status === 414) expect(body.requestId).toBe(id);
    },
  );

  /**
   * The same guards outside `/api/v1`, where no door-level stamper follows
   * them: each refusal is `no-store` by its own hand (2026-09-13 round-e
   * evaluation, S4 — the app door's 401 carried no directive at all),
   * while the contract version stays a promise of the doors the OpenAPI
   * document describes, which the app door is not.
   */
  it.each([
    [
      'a key in x-api-key on the app door',
      'http://localhost/api/app/video-links/unbound?orgId=org-1',
      { headers: { cookie: 'tale.session=good', 'x-api-key': 'tale_leaked' } },
      401,
      'UNAUTHORIZED',
    ],
    [
      'a NUL in an app-door URL',
      'http://localhost/api/app/video-links/a%00b',
      { headers: { cookie: 'tale.session=good' } },
      400,
      'INVALID_URL',
    ],
  ])(
    'answers %s uncacheable, without the REST door’s version header',
    async (_name, url, init, status, code) => {
      const res = await app().request(url, init);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-tale-api-version')).toBeNull();
      const body: { code: string } = await res.json();
      expect(body.code).toBe(code);
    },
  );

  /**
   * The two inbound webhook doors sit in the OpenAPI document, whose every
   * operation promises `X-Tale-Api-Version`; they used to answer without
   * it (2026-09-13 round-e evaluation, E4-06). A token past the door's
   * length cap is refused before the sender's budget is charged, so the
   * double needs no trusted-proxy list — the header is the stamper's, not
   * the handler's.
   */
  it('stamps the contract version on both webhook doors', async () => {
    const token = 'x'.repeat(1000);
    for (const path of [
      `/api/automations/webhook/${token}`,
      `/api/projects/p-1/automations/webhook/${token}`,
    ]) {
      const res = await app().request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(404);
      expect(res.headers.get('x-tale-api-version')).toMatch(/^\d+\.\d+\.\d+$/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('validates the app surface the same way', async () => {
    // The app surface is a signed-in session; a key in `x-api-key` is
    // refused before any door (it used to act as the key holder's session
    // on every route), so the double answers a cookie here.
    const headers = { cookie: 'tale.session=good' };
    const first = await app().request(
      'http://localhost/api/app/video-links/unbound?orgId=org-1',
      { headers },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ jobs: [] });
    const etag = first.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const res = await app().request(
      'http://localhost/api/app/video-links/unbound?orgId=org-1',
      { headers: { ...headers, 'if-none-match': `W/${etag}` } },
    );
    expect(res.status).toBe(304);
  });
});
