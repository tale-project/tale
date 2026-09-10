// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../auth/auth.ts';
import { mountRestV1Routes } from './v1.ts';

/**
 * Every non-2xx on the /api/v1 door is the documented JSON envelope. The
 * regression under test: a path no family served fell through to the app's
 * text/plain `404 Not Found`, so a client that mistyped a route (or hit a
 * method a collection does not take) got the one response shape the API
 * reference says never happens.
 */

vi.mock('../auth/auth.ts', () => ({
  API_KEY_RATE_LIMIT: { enabled: false, timeWindow: 60_000, maxRequests: 100 },
  loadTrustedProxies: () => Promise.resolve(['loopback', 'uniquelocal']),
}));

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve([{ organizationId: 'org-1', role: 'member' }]);
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

function fakeAuth(): Auth {
  const getSession = ({ headers }: { headers: Headers }) =>
    Promise.resolve(
      headers.get('x-api-key') === 'tale_good'
        ? { user: { id: 'user-1', email: 'user@example.com' }, session: {} }
        : null,
    );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { api: { getSession } } as unknown as Auth;
}

/** The app's wiring: the door mounted at /api/v1 with its catch-all. */
function root() {
  const app = new Hono();
  mountRestV1Routes(app, { sql: fakeSql(), auth: fakeAuth() });
  app.get('/elsewhere', (c) => c.text('outside the door'));
  return app;
}

describe('/api/v1 door — unknown paths', () => {
  const bearer = { headers: { authorization: 'Bearer tale_good' } };

  it('answers a path no family serves with the JSON 404 envelope', async () => {
    const res = await root().request('http://localhost/api/v1/nope', bearer);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('answers a method a collection does not take the same way', async () => {
    const res = await root().request('http://localhost/api/v1/automations', {
      method: 'PATCH',
      ...bearer,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('still lets the door refuse an unauthenticated request first', async () => {
    const res = await root().request('http://localhost/api/v1/nope');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('leaves routes outside the door alone', async () => {
    const res = await root().request('http://localhost/elsewhere');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('outside the door');
  });
});
