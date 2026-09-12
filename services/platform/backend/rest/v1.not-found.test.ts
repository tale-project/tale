// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../auth/auth.ts';
import { apiPathWithoutTrailingSlash } from '../lib/http-hygiene.ts';
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
    expect(await res.json()).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });

  /**
   * RFC 9110 §15.5.6: a path a family serves, asked with a method it does
   * not take, is 405 with `Allow` — the door used to answer 404, telling a
   * client the collection did not exist rather than which verbs it takes.
   */
  it('answers 405 with Allow for a method a served path does not take', async () => {
    const res = await root().request('http://localhost/api/v1/automations', {
      method: 'PATCH',
      ...bearer,
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect(await res.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('lists every verb a parameterised path takes', async () => {
    const res = await root().request(
      'http://localhost/api/v1/knowledge-entries/some-id',
      { method: 'PUT', ...bearer },
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, PATCH, DELETE, HEAD, OPTIONS');
  });

  it('answers OPTIONS on a served path with the same Allow list and no body', async () => {
    const res = await root().request('http://localhost/api/v1/automations', {
      method: 'OPTIONS',
      ...bearer,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  /**
   * The MCP URL takes POST and nothing else — no event stream to GET, no
   * session to DELETE — and the door's own catch-all says so with ONE
   * `Allow` list; the verbs used to be registered as 405 stubs, which made
   * the same catch-all list them as served on OPTIONS.
   */
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])(
    'answers %s /api/v1/mcp with 405 and Allow: POST',
    async (method) => {
      const res = await root().request('http://localhost/api/v1/mcp', {
        method,
        ...bearer,
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST, OPTIONS');
      expect(await res.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
    },
  );

  it('answers OPTIONS /api/v1/mcp with the same one-verb Allow list', async () => {
    const res = await root().request('http://localhost/api/v1/mcp', {
      method: 'OPTIONS',
      ...bearer,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('keeps 404 for a method on a path nobody serves', async () => {
    const res = await root().request('http://localhost/api/v1/nope', {
      method: 'OPTIONS',
      ...bearer,
    });
    expect(res.status).toBe(404);
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

describe('/api/v1 door — OPTIONS without a key, and no CORS', () => {
  it('answers a key-less OPTIONS on a served path with 204 and the Allow list', async () => {
    const res = await root().request('http://localhost/api/v1/contacts', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('GET, POST, HEAD, OPTIONS');
    for (const name of [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
    ]) {
      expect(res.headers.get(name)).toBeNull();
    }
  });

  it('answers a key-less OPTIONS on a path nobody serves with the 404 envelope', async () => {
    const res = await root().request('http://localhost/api/v1/nope', {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });

  it('still needs a key for anything but OPTIONS', async () => {
    const res = await root().request('http://localhost/api/v1/contacts');
    expect(res.status).toBe(401);
  });
});

describe('/api/v1 door — what every answer carries', () => {
  const bearer = { headers: { authorization: 'Bearer tale_good' } };

  it('names the contract version and no-store on the catch-all too', async () => {
    const missing = await root().request(
      'http://localhost/api/v1/nope',
      bearer,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-tale-api-version')).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
    expect(missing.headers.get('cache-control')).toBe('no-store');
    const wrongVerb = await root().request(
      'http://localhost/api/v1/automations',
      { method: 'PATCH', ...bearer },
    );
    expect(wrongVerb.status).toBe(405);
    expect(wrongVerb.headers.get('x-tale-api-version')).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it('measures a JSON answer for HEAD, so a client can size it before fetching', async () => {
    const got = await root().request('http://localhost/api/v1/me', bearer);
    expect(got.status).toBe(200);
    const body = await got.text();
    const head = await root().request('http://localhost/api/v1/me', {
      method: 'HEAD',
      ...bearer,
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(await head.text()).toBe('');
  });
});

describe('/api/v1 door — a trailing slash', () => {
  /** The app's root wiring: the path normaliser installed as `getPath`. */
  function normalisingRoot() {
    const app = new Hono({ getPath: apiPathWithoutTrailingSlash });
    mountRestV1Routes(app, { sql: fakeSql(), auth: fakeAuth() });
    return app;
  }

  it('routes /api/v1/automations/ like /api/v1/automations', async () => {
    const res = await normalisingRoot().request(
      'http://localhost/api/v1/automations/',
      { method: 'OPTIONS' },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('keeps a doubled slash a 404', async () => {
    const res = await normalisingRoot().request(
      'http://localhost/api/v1/automations//',
      { method: 'OPTIONS' },
    );
    expect(res.status).toBe(404);
  });
});
