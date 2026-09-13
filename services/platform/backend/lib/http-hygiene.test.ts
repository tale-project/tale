// @vitest-environment node

import { connect } from 'node:net';

import { createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';

import { API_CONTRACT_VERSION } from '../../lib/shared/constants/api-contract.ts';
import {
  apiKeyHeaderGuard,
  apiNotFound,
  backendSecureHeaders,
  headContentLength,
  nulUrlGuard,
  noStoreByDefault,
  apiPathWithoutTrailingSlash,
  BodilessAwareResponse,
  BACKEND_SERVER_OPTIONS,
  installClientErrorEnvelope,
  restDoorHeaders,
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
    // Uncacheable by its own hand: outside `/api/v1` no stamper follows.
    expect(res.headers.get('cache-control')).toBe('no-store');
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

  it('refuses a request that carries the plugin header, before any door, uncacheable', async () => {
    const res = await guarded.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { 'x-api-key': 'tale_leaked' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    // On the sign-in and app doors no stamper follows the guard, and a 401
    // an intermediary kept would be served to the next caller.
    expect(res.headers.get('cache-control')).toBe('no-store');
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
  // The app's request id runs ahead of the guard, as in `createApp`, so the
  // refusal has an id to repeat.
  guarded.use(requestId());
  guarded.use(uriLengthGuard());
  guarded.get('/api/v1/contacts', (c) => c.json({ ok: true }));

  it('lets a request target up to the budget through', async () => {
    const query = 'q='.padEnd(32 * 1024 - '/api/v1/contacts?'.length, 'a');
    const res = await guarded.request(
      `http://localhost/api/v1/contacts?${query}`,
    );
    expect(res.status).toBe(200);
  });

  it('answers 414 in the envelope one byte over it, before any route runs, repeating the request id', async () => {
    const query = 'q='.padEnd(32 * 1024 - '/api/v1/contacts?'.length + 1, 'a');
    const res = await guarded.request(
      `http://localhost/api/v1/contacts?${query}`,
    );
    expect(res.status).toBe(414);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // The body repeats the id the way the 413 and the 500 do — the one
    // enveloped refusal that did not, so `body.requestId` was undefined
    // on exactly the request a caller most wanted to quote.
    expect(await res.json()).toEqual({
      error: 'The request URL exceeds 32 KiB (path and query)',
      code: 'URI_TOO_LONG',
      requestId: id,
    });
  });

  it('leaves the id out when nothing upstream stamped one', async () => {
    const bare = new Hono();
    bare.use(uriLengthGuard(16));
    const res = await bare.request('http://localhost/api/v1/contacts?q=aaaa');
    expect(res.status).toBe(414);
    expect(await res.json()).toEqual({
      error: 'The request URL exceeds 0.015625 KiB (path and query)',
      code: 'URI_TOO_LONG',
    });
  });
});

describe('noStoreByDefault', () => {
  const door = new Hono();
  door.use(noStoreByDefault());
  door.get('/plain', (c) => c.json({ ok: true }));
  door.get('/own', (c) =>
    c.json({ ok: true }, 200, { 'cache-control': 'private, no-store' }),
  );

  it('stamps no-store where the route chose nothing, and keeps a directive the route chose', async () => {
    expect(
      (await door.request('http://localhost/plain')).headers.get(
        'cache-control',
      ),
    ).toBe('no-store');
    expect(
      (await door.request('http://localhost/own')).headers.get('cache-control'),
    ).toBe('private, no-store');
  });
});

/**
 * The REST door's contract headers as `createApp` mounts them: on
 * `/api/v1/*` AHEAD of the pre-route guards. The regression under test
 * (2026-09-12 round-d evaluation, S3-2/S3-3 and the NUL twin): the stamper
 * lived inside the door, behind the guards, so the x-api-key 401, the 414
 * and the NUL 400 carried neither `X-Tale-Api-Version` nor `Cache-Control`
 * — the only enveloped answers on the surface that did not.
 */
describe('restDoorHeaders', () => {
  function wired() {
    const hono = new Hono();
    hono.use(requestId());
    hono.use('/api/v1/*', restDoorHeaders());
    hono.use(apiKeyHeaderGuard(['x-api-key']));
    hono.use(uriLengthGuard());
    hono.use(nulUrlGuard());
    hono.get('/api/v1/me', (c) => c.json({ id: 'user-1' }));
    hono.get('/api/v1/blob', (c) =>
      c.json({ id: 'b' }, 200, { 'cache-control': 'private, no-store' }),
    );
    hono.get('/elsewhere', (c) => c.json({ outside: true }));
    return hono;
  }

  it('names the contract version and no-store on a served answer, keeps a directive the route chose', async () => {
    const res = await wired().request('http://localhost/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tale-api-version')).toBe(API_CONTRACT_VERSION);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const own = await wired().request('http://localhost/api/v1/blob');
    expect(own.headers.get('x-tale-api-version')).toBe(API_CONTRACT_VERSION);
    expect(own.headers.get('cache-control')).toBe('private, no-store');
  });

  it('measures a JSON answer for HEAD', async () => {
    const got = await wired().request('http://localhost/api/v1/me');
    const body = await got.text();
    const head = await wired().request('http://localhost/api/v1/me', {
      method: 'HEAD',
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(await head.text()).toBe('');
  });

  it.each([
    [
      'the x-api-key 401',
      'http://localhost/api/v1/me',
      { headers: { 'x-api-key': 'tale_leaked' } },
      401,
    ],
    [
      'the 414',
      `http://localhost/api/v1/me?q=${'a'.repeat(32 * 1024)}`,
      {},
      414,
    ],
    ['the NUL 400', 'http://localhost/api/v1/documents/a%00b', {}, 400],
  ])(
    'stamps both headers on %s, a refusal answered ahead of any route',
    async (_name, url, init, status) => {
      const res = await wired().request(url, init);
      expect(res.status).toBe(status);
      expect(res.headers.get('x-tale-api-version')).toBe(API_CONTRACT_VERSION);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toContain('application/json');
    },
  );

  it('leaves the rest of the app alone', async () => {
    const res = await wired().request('http://localhost/elsewhere');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tale-api-version')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
  });
});

/**
 * The HEAD length for a door outside the REST door — the four web-tier
 * doors (`/api/health`, `/status`, `/status.json`, `/openapi.json`)
 * answered `content-length: 0` (2026-09-13 round-e evaluation, E1-03).
 * One rule with `restDoorHeaders`: a JSON or text document is measured, a
 * length the route named is kept, a binary stream is left alone.
 */
describe('headContentLength', () => {
  function wired() {
    const hono = new Hono();
    for (const door of ['/health', '/page', '/sized', '/blob']) {
      hono.use(door, headContentLength());
    }
    hono.get('/health', (c) => c.json({ status: 'ok', version: '0.5.24' }));
    hono.get('/page', (c) => c.html('<!doctype html><p>operational</p>'));
    hono.get('/sized', (c) =>
      c.body('twelve bytes', 200, {
        'content-type': 'text/plain',
        'content-length': '12',
      }),
    );
    hono.get(
      '/blob',
      () =>
        new Response(new Uint8Array(8), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    hono.get('/elsewhere', (c) => c.json({ outside: true }));
    return hono;
  }

  it.each([
    ['/health', 'application/json'],
    ['/page', 'text/html'],
  ])('measures the GET’s %s answer for HEAD', async (path, type) => {
    const got = await wired().request(`http://localhost${path}`);
    const body = await got.text();
    expect(got.headers.get('content-type')).toContain(type);
    const head = await wired().request(`http://localhost${path}`, {
      method: 'HEAD',
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(await head.text()).toBe('');
  });

  it('keeps a length the route named, and leaves a binary stream, a GET and the rest of the app alone', async () => {
    const sized = await wired().request('http://localhost/sized', {
      method: 'HEAD',
    });
    expect(sized.headers.get('content-length')).toBe('12');
    const blob = await wired().request('http://localhost/blob', {
      method: 'HEAD',
    });
    expect(blob.headers.get('content-length')).toBeNull();
    const get = await wired().request('http://localhost/health');
    expect(get.headers.get('content-length')).toBeNull();
    expect(await get.json()).toEqual({ status: 'ok', version: '0.5.24' });
    const outside = await wired().request('http://localhost/elsewhere', {
      method: 'HEAD',
    });
    expect(outside.headers.get('content-length')).toBeNull();
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

/**
 * The listener-level refusals (Node's `clientError`) in the door's own
 * envelope. The regression under test (2026-09-12 round-d evaluation,
 * S3-6): a 30.5 MB staged upload — inside the documented cap — on a slow
 * link hit Node's default 5-minute `requestTimeout` and got a bare
 * `HTTP/1.1 408 Request Timeout` with no body, no code and no request id;
 * a header block over the budget and non-HTTP bytes answered the same way.
 * A real listener, because the adapter builds the server and Node raises
 * the event below any middleware.
 */
describe('installClientErrorEnvelope', () => {
  interface RawResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
  }

  /** Parses the one response a raw exchange produced. */
  function parse(wire: string): RawResponse {
    const [head = '', body = ''] = wire.split('\r\n\r\n');
    const [line = '', ...rest] = head.split('\r\n');
    const headers: Record<string, string> = {};
    for (const field of rest) {
      const at = field.indexOf(':');
      headers[field.slice(0, at).toLowerCase()] = field.slice(at + 1).trim();
    }
    return { status: Number(line.split(' ')[1]), headers, body };
  }

  async function listening(overrides: Record<string, unknown> = {}) {
    const hono = new Hono();
    hono.get('/ping', (c) => c.json({ ok: true }));
    hono.post('/api/v1/conversations/uploads', async (c) => {
      await c.req.arrayBuffer();
      return c.json({ ok: true }, 201);
    });
    const server = createAdaptorServer({
      fetch: hono.fetch,
      serverOptions: {
        ...BACKEND_SERVER_OPTIONS,
        // The deployment's 15 minutes, scaled down: Node requires
        // `headersTimeout` at or below `requestTimeout`, and the sweep
        // that enforces both runs on `connectionsCheckingInterval`.
        requestTimeout: 200,
        headersTimeout: 200,
        connectionsCheckingInterval: 50,
        ...overrides,
      },
    });
    installClientErrorEnvelope(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }
    return {
      port: address.port,
      close: () =>
        new Promise<void>((resolve, reject) => {
          if ('closeAllConnections' in server) server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }

  /** Writes `chunks` in order and collects everything the server sends
   * until it closes the connection (or resets it after answering). */
  function exchange(
    port: number,
    chunks: string[],
    options: { afterFirstResponse?: string } = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let wire = '';
      let sentSecond = false;
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        for (const chunk of chunks) socket.write(chunk);
      });
      socket.on('data', (data: string) => {
        wire += data;
        if (
          options.afterFirstResponse !== undefined &&
          !sentSecond &&
          wire.includes('\r\n\r\n')
        ) {
          sentSecond = true;
          socket.write(options.afterFirstResponse);
        }
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        // A reset after the answer left is how a destroyed socket reads
        // from the client's side; nothing answered at all is the failure.
        if (wire === '') reject(error);
      });
      socket.on('close', () => resolve(wire));
    });
  }

  const partialUpload =
    'POST /api/v1/conversations/uploads HTTP/1.1\r\n' +
    'Host: 127.0.0.1\r\n' +
    'Content-Type: application/octet-stream\r\n' +
    'Content-Length: 1000000\r\n' +
    '\r\n' +
    'a few bytes and then silence';

  function expectEnvelope(
    res: RawResponse,
    status: number,
    code: string,
  ): { error: string; code: string; requestId: string } {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-tale-api-version']).toBe(API_CONTRACT_VERSION);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.connection).toBe('close');
    expect(res.headers['content-length']).toBe(
      String(Buffer.byteLength(res.body)),
    );
    const body = JSON.parse(res.body) as {
      error: string;
      code: string;
      requestId: string;
    };
    expect(body.code).toBe(code);
    expect(body.requestId).toBe(res.headers['x-request-id']);
    return body;
  }

  it('answers a body that stops arriving with a JSON 408 REQUEST_TIMEOUT, then closes', async () => {
    const { port, close } = await listening();
    try {
      const res = parse(await exchange(port, [partialUpload]));
      const body = expectEnvelope(res, 408, 'REQUEST_TIMEOUT');
      expect(body.error).toBe(
        'The request did not finish arriving within 0.2 seconds (headers and body together); the connection is closed — send the body on a faster link or in smaller pieces',
      );
    } finally {
      await close();
    }
  });

  it('still answers it on a keep-alive connection that already served a request', async () => {
    // The proxy pools its upstream connections, so this — not a fresh
    // socket — is the shape nearly every real timeout has; a rule keyed on
    // `socket.bytesWritten === 0` would have destroyed it unanswered.
    const { port, close } = await listening();
    try {
      const wire = await exchange(
        port,
        ['GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'],
        { afterFirstResponse: partialUpload },
      );
      const [first, second] = wire.split(/(?=HTTP\/1\.1 408)/);
      expect(parse(first ?? '').status).toBe(200);
      expectEnvelope(parse(second ?? ''), 408, 'REQUEST_TIMEOUT');
    } finally {
      await close();
    }
  });

  it('answers bytes that are not HTTP with a JSON 400 HTTP_ERROR', async () => {
    const { port, close } = await listening();
    try {
      const res = parse(await exchange(port, ['GARBAGE\r\n\r\n']));
      const body = expectEnvelope(res, 400, 'HTTP_ERROR');
      expect(body.error).toContain('could not be read as HTTP');
    } finally {
      await close();
    }
  });

  it('answers a header block over the budget with a JSON 431', async () => {
    const { port, close } = await listening({ maxHeaderSize: 1024 });
    try {
      const res = parse(
        await exchange(port, [
          `GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Big: ${'a'.repeat(2048)}\r\n\r\n`,
        ]),
      );
      const body = expectEnvelope(res, 431, 'HTTP_ERROR');
      expect(body.error).toBe(
        'The request headers exceed 1 KiB; the connection is closed — carry data in the body, never in a header',
      );
    } finally {
      await close();
    }
  });
});
