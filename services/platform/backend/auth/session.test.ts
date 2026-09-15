// @vitest-environment node

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

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
