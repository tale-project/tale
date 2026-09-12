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
