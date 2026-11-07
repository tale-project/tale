import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { localOnly, requestRefusal } from './security.ts';

const HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1:3004',
  'localhost:3004',
]);
const OWN = 'http://127.0.0.1:3004';

/** An app behind the guard that records what got past it. */
function guarded(hosts: ReadonlySet<string> = HOSTS) {
  const reached: string[] = [];
  const app = new Hono();
  app.use(localOnly(hosts));
  app.all('*', (c) => {
    reached.push(`${c.req.method} ${c.req.path}`);
    return c.json({ ok: true });
  });
  return { app, reached };
}

interface Call {
  method?: string;
  path?: string;
  /** The Host header; null: none. */
  host?: string | null;
  origin?: string;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  url?: string;
}

function call(
  app: Hono,
  {
    method = 'GET',
    path = '/api/meta',
    host = '127.0.0.1:3004',
    origin,
    contentType,
    body,
    headers = {},
    url = OWN,
  }: Call = {},
): Response | Promise<Response> {
  const sent = new Headers(headers);
  if (host !== null) sent.set('Host', host);
  if (origin !== undefined) sent.set('Origin', origin);
  if (contentType !== undefined) sent.set('Content-Type', contentType);
  return app.request(`${url}${path}`, { method, headers: sent, body });
}

const JSON_BODY = '{"proxy":"192.0.2.1:8080"}';

describe('the Host header', () => {
  it.each([
    'evil.example:3004',
    '127.0.0.1:9999',
    '127.0.0.1',
    '192.168.1.10:3004',
  ])('refuses a request that addresses the app as %s', async (host) => {
    const { app, reached } = guarded();
    const response = await call(app, { host });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden_host',
      message: 'Requests must address the app as 127.0.0.1 or localhost.',
    });
    expect(reached).toEqual([]);
  });

  it('refuses a request without a Host header', async () => {
    const { app, reached } = guarded();
    const response = await call(app, { host: null });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('forbidden_host');
    expect(reached).toEqual([]);
  });

  it.each(['127.0.0.1:3004', 'localhost:3004', 'LOCALHOST:3004'])(
    'accepts a request that addresses the app as %s',
    async (host) => {
      const { app } = guarded();
      expect((await call(app, { host })).status).toBe(200);
    },
  );

  it('refuses a request with two Host headers, which join into one unknown value', async () => {
    const { app } = guarded();
    const response = await call(app, {
      host: null,
      headers: { Host: '127.0.0.1:3004, evil.example' },
    });
    expect(response.status).toBe(403);
  });

  it('accepts the operator’s own host names and no others', async () => {
    const hosts = new Set([...HOSTS, 'sm.example.com']);
    const { app } = guarded(hosts);
    expect((await call(app, { host: 'sm.example.com' })).status).toBe(200);
    expect((await call(app, { host: 'other.example.com' })).status).toBe(403);
  });

  it('checks the host of every method, not only the state-changing ones', async () => {
    const { app } = guarded();
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE']) {
      const response = await call(app, { method, host: 'evil.example:3004' });
      expect(response.status, method).toBe(403);
    }
  });
});

describe('the Origin of a state-changing request', () => {
  it.each([
    'http://evil.example',
    'http://127.0.0.1:9999',
    'null',
    'https://127.0.0.1:3004',
  ])('refuses a POST from %s', async (origin) => {
    const { app, reached } = guarded();
    const response = await call(app, {
      method: 'POST',
      path: '/api/proxies',
      origin,
      contentType: 'application/json',
      body: JSON_BODY,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden_origin',
      message: 'Cross-site requests are not allowed.',
    });
    expect(reached).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s from a foreign origin',
    async (method) => {
      const { app, reached } = guarded();
      const response = await call(app, {
        method,
        origin: 'http://evil.example',
      });
      expect(response.status).toBe(403);
      expect(reached).toEqual([]);
    },
  );

  it('accepts the app’s own origin, and no Origin at all', async () => {
    const { app } = guarded();
    for (const origin of [OWN, undefined]) {
      const response = await call(app, {
        method: 'POST',
        path: '/api/proxies/import',
        origin,
        contentType: 'application/json',
        body: '{"text":"192.0.2.1:8080"}',
      });
      expect(response.status).toBe(200);
    }
    const localhost = await call(app, {
      method: 'POST',
      path: '/api/proxies/check-all',
      host: 'localhost:3004',
      origin: 'http://localhost:3004',
    });
    expect(localhost.status).toBe(200);
  });

  it('refuses another site on the same machine: the origin must be the page’s host', async () => {
    const { app } = guarded();
    const response = await call(app, {
      method: 'POST',
      origin: 'http://localhost:3004',
    });
    expect(response.status).toBe(403);
  });

  it('only checks the origin of a DELETE, which has no body', async () => {
    const { app, reached } = guarded();
    const foreign = await call(app, {
      method: 'DELETE',
      path: '/api/proxies/1',
      origin: 'http://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(reached).toEqual([]);
    const own = await call(app, { method: 'DELETE', path: '/api/proxies/1' });
    expect(own.status).toBe(200);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'does not check the origin of %s requests: the same-origin policy keeps other sites from reading the answer',
    async (method) => {
      const { app } = guarded();
      const response = await call(app, {
        method,
        path: '/api/sessions',
        origin: 'http://evil.example',
      });
      expect(response.status).toBe(200);
    },
  );
});

describe('the body of a state-changing request', () => {
  it.each([
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['no Content-Type', undefined],
  ])('refuses a body sent with %s', async (_name, contentType) => {
    const { app, reached } = guarded();
    const response = await call(app, {
      method: 'POST',
      path: '/api/proxies',
      contentType,
      body: JSON_BODY,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden_origin',
      message: 'Request bodies must be sent as application/json.',
    });
    expect(reached).toEqual([]);
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
    '  application/json ;charset=UTF-8',
  ])('may say it is JSON as %j', async (contentType) => {
    const { app } = guarded();
    const response = await call(app, {
      method: 'PATCH',
      contentType,
      body: JSON_BODY,
    });
    expect(response.status).toBe(200);
  });

  it('is refused when only the length headers say there is one', async () => {
    const { app } = guarded();
    const claims: Array<Record<string, string>> = [
      { 'Content-Length': '12', 'Content-Type': 'text/plain' },
      { 'Transfer-Encoding': 'chunked', 'Content-Type': 'text/plain' },
    ];
    for (const headers of claims) {
      const response = await call(app, { method: 'POST', headers });
      expect(response.status).toBe(403);
    }
  });

  it('needs no Content-Type when there is none', async () => {
    const { app } = guarded();
    const none: Array<Record<string, string>> = [{}, { 'Content-Length': '0' }];
    for (const headers of none) {
      const response = await call(app, { method: 'POST', headers });
      expect(response.status).toBe(200);
    }
  });

  it('is not looked at for a read', async () => {
    const { app } = guarded();
    const response = await call(app, {
      method: 'GET',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(response.status).toBe(200);
  });
});

describe('Sec-Fetch-Site', () => {
  // What a browser says about who started a request: `cross-site` (another
  // site), `same-site` (another origin of the same site: another port of this
  // machine), `same-origin` (the page itself), `none` (the person: the address
  // bar, a bookmark). A program sends nothing.
  const EXPORT = '/api/sessions/export-proxies';

  it.each(['cross-site', 'same-site'])(
    'refuses a download of the passwords that a %s page started: a browser would save it in Downloads',
    async (site) => {
      const { app, reached } = guarded();
      const response = await call(app, {
        path: EXPORT,
        origin: 'http://evil.example',
        headers: {
          'Sec-Fetch-Site': site,
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Dest': 'document',
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'forbidden_origin',
        message: 'Cross-site requests are not allowed.',
      });
      expect(reached).toEqual([]);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses a cross-site %s, whatever the method is',
    async (method) => {
      const { app, reached } = guarded();
      const response = await call(app, {
        method,
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      expect(response.status).toBe(403);
      expect(reached).toEqual([]);
    },
  );

  it.each([
    ['the page itself', 'same-origin'],
    ['the person (the address bar, a bookmark)', 'none'],
    ['the page, in capitals', 'SAME-ORIGIN'],
  ])('lets %s through: %s', async (_who, site) => {
    const { app } = guarded();
    for (const path of ['/api/meta', EXPORT, '/mcp']) {
      const response = await call(app, {
        path,
        headers: { 'Sec-Fetch-Site': site },
      });
      expect(response.status, path).toBe(200);
    }
  });

  it('lets a program through, which sends no such header', async () => {
    const { app } = guarded();
    expect((await call(app, { path: EXPORT })).status).toBe(200);
  });

  it.each(['cross-site ', ' same-site', 'CROSS-SITE', 'bogus', ''])(
    'refuses a value it does not know or only differs in spaces and capitals from a refused one: %j',
    async (site) => {
      const { app } = guarded();
      const response = await call(app, {
        headers: { 'Sec-Fetch-Site': site },
      });
      expect(response.status).toBe(403);
    },
  );

  it('names a foreign host before a foreign site', async () => {
    const { app } = guarded();
    const response = await call(app, {
      host: 'evil.example:3004',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect((await response.json()).error).toBe('forbidden_host');
  });

  it('is not asked of the page itself: a link from another site may open the page', () => {
    const navigation = new Request(`${OWN}/`, {
      headers: {
        Host: '127.0.0.1:3004',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
      },
    });
    expect(requestRefusal(navigation, HOSTS, 'page')).toBeNull();
    expect(requestRefusal(navigation, HOSTS)?.code).toBe('forbidden_origin');
    expect(requestRefusal(navigation, HOSTS, 'api')?.code).toBe(
      'forbidden_origin',
    );
  });
});

describe('requestRefusal', () => {
  it('names the first problem: the host before the origin before the body', () => {
    const request = new Request('http://evil.example/api', {
      method: 'POST',
      headers: {
        Host: 'evil.example',
        Origin: 'http://evil.example',
        'Content-Type': 'text/plain',
      },
      body: 'x',
    });
    expect(requestRefusal(request, HOSTS)?.code).toBe('forbidden_host');
    const ownHost = new Request(`${OWN}/api`, {
      method: 'POST',
      headers: {
        Host: '127.0.0.1:3004',
        Origin: 'http://evil.example',
        'Content-Type': 'text/plain',
      },
      body: 'x',
    });
    expect(requestRefusal(ownHost, HOSTS)?.message).toBe(
      'Cross-site requests are not allowed.',
    );
  });

  it('is null for a request that may go on', () => {
    const request = new Request(`${OWN}/api`, {
      method: 'POST',
      headers: { Host: '127.0.0.1:3004', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(requestRefusal(request, HOSTS)).toBeNull();
  });
});
