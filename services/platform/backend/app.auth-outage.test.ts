// @vitest-environment node

import { createServer, type AddressInfo } from 'node:net';

import type { Sql } from 'postgres';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import { createAuth, type Auth } from './auth/auth.ts';
import { signCookieValue } from './core/enterprise_sso/sign_cookie_value.ts';

/**
 * Better Auth's routes while the database is away, through the real app and the
 * real library against a port nothing listens on. The library reads the session
 * in its middleware and, when the read throws, carries on without one: the
 * endpoint answered a 401 `UNAUTHORIZED` for a session that was perfectly good.
 * The app reads that 401 as "this session ended" and takes the tab to sign-in
 * (`app/lib/auth/auth-client-error.ts`), so a database restart signed people
 * out; `get-session` answered a bare 500. They answer the retryable 503
 * `DATABASE_UNAVAILABLE` every other door does. A request with no session at
 * all never meets the database, and keeps its 401.
 */

const SECRET = 'test-secret-at-least-16-chars';
const ORIGIN = 'http://localhost:3000';

/** A port nothing listens on: bound, read, released. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

let databaseUrl: string;
let auth: Auth;
let cookie: string;

beforeAll(async () => {
  databaseUrl = `postgresql://tale:pw@127.0.0.1:${await closedPort()}/tale_app`;
  cookie = `better-auth.session_token=${await signCookieValue('session-token', SECRET)}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const pool = auth.options.database;
  if (typeof pool === 'object' && pool !== null && 'end' in pool) {
    await (pool as { end(): Promise<void> }).end();
  }
});

function app() {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The app query lane is down as well: nothing under /api/auth reaches it.
  const sql = (() =>
    Promise.reject(new Error('unreachable'))) as unknown as Sql;
  auth = createAuth({
    databaseUrl,
    secret: SECRET,
    baseUrl: ORIGIN,
    sql,
  });
  return createApp({ sql, auth });
}

const post = (body: unknown, headers: Record<string, string>) => ({
  method: 'POST',
  headers: {
    origin: ORIGIN,
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
});

describe('Better Auth’s routes when the database is unavailable', () => {
  it.each([
    [
      'a session middleware route that answered 401',
      'POST',
      '/api/auth/organization/set-active',
    ],
    [
      'a listing behind the session middleware',
      'GET',
      '/api/auth/api-key/list',
    ],
    [
      'the session read, which answered a bare 500',
      'GET',
      '/api/auth/get-session',
    ],
  ])('answers %s with the retryable 503', async (_name, method, path) => {
    const res = await app().request(
      `${ORIGIN}${path}`,
      method === 'POST'
        ? post({ organizationId: 'org-1' }, { cookie })
        : { headers: { cookie, origin: ORIGIN } },
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('keeps the 401 of a request that carries no session, which never meets the database', async () => {
    const res = await app().request(
      `${ORIGIN}/api/auth/organization/set-active`,
      post({ organizationId: 'org-1' }, {}),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
