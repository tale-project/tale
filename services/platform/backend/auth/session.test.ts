// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { AUTH_INVALIDATION_TRIGGERS } from '../db/auth-invalidation-triggers.ts';
import {
  startAuthRequestCache,
  stopAuthRequestCache,
} from './request-cache.ts';
import { requireSession } from './session.ts';

/**
 * The session doors speak the one flat envelope every other door does: the
 * bare `{"error":"unauthorized"}` a client branching on `code` could not
 * read is gone (2026-09-14 evaluation, h8).
 */
describe('requireSession', () => {
  it('answers a missing session with the coded envelope, uncached', async () => {
    const app = new Hono();
    const auth = { api: { getSession: async () => null } };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard reads only getSession
    app.use(requireSession(auth as never));
    app.get('/events', (c) => c.text('open'));
    const res = await app.request('http://localhost/events');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      error: expect.stringContaining('Authorization: Bearer'),
    });
  });

  it('lets a session through and hands the bundle to the route', async () => {
    const app = new Hono<{ Variables: { sessionBundle: unknown } }>();
    const bundle = { user: { id: 'u-1' }, session: { id: 's-1' } };
    const auth = { api: { getSession: async () => bundle } };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard reads only getSession
    app.use(requireSession(auth as never));
    app.get('/events', (c) => c.json(c.get('sessionBundle')));
    const res = await app.request('http://localhost/events');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(bundle);
  });
});

describe('requireSession with the process auth cache', () => {
  afterEach(async () => {
    await stopAuthRequestCache();
  });

  /** A database whose triggers are all there and whose log is empty. */
  function quietDatabase(): Sql {
    const sql = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      return Promise.resolve(
        text.includes('FROM pg_trigger')
          ? AUTH_INVALIDATION_TRIGGERS.map((name) => ({ name }))
          : [{ horizon: '1', id: null, kind: null, subjectId: null }],
      );
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
    return sql as unknown as Sql;
  }

  it('answers a repeat request from memory, keyed by the very cookie Better Auth reads', async () => {
    const week = 7 * 24 * 3600;
    const cache = startAuthRequestCache(
      quietDatabase(),
      { sessionConfig: { expiresIn: week, updateAge: 60 }, loop: false },
      {},
    );
    await cache?.poll();
    const bundle = {
      user: { id: 'u-1', email: 'a@example.invalid', name: 'A' },
      session: {
        id: 's-1',
        token: 'tok',
        expiresAt: new Date(Date.now() + week * 1000),
      },
    };
    let resolved = 0;
    const auth = {
      $context: Promise.resolve({
        authCookies: { sessionToken: { name: 'better-auth.session_token' } },
      }),
      api: {
        getSession: async () => {
          resolved += 1;
          return bundle;
        },
      },
    };
    const app = new Hono();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard reads only $context and getSession
    app.use(requireSession(auth as never));
    app.get('/events', (c) => c.text('open'));
    const once = { cookie: 'better-auth.session_token=tok.sig' };
    expect((await app.request('/events', { headers: once })).status).toBe(200);
    expect((await app.request('/events', { headers: once })).status).toBe(200);
    expect(resolved).toBe(1);
    // A session cookie sent twice is Better Auth's alone to read.
    const twice = {
      cookie:
        'better-auth.session_token=tok.sig; better-auth.session_token=tok.sig',
    };
    await app.request('/events', { headers: twice });
    await app.request('/events', { headers: twice });
    expect(resolved).toBe(3);
  });
});
