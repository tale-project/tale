import { afterEach, describe, expect, it, vi } from 'vitest';

import { metaSchema } from '../lib/api/schemas.ts';
import { MAX_PROXY_IMPORT } from '../lib/proxy-limits.ts';
import { importResult, meta } from '../tests/utils/fixtures.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import type { Manager } from './domains/sessions/manager.ts';
import { AppError } from './errors.ts';
import {
  apiClient,
  expectError,
  expectJson,
  TEST_HOST,
  testApp,
} from './testing/api-client.ts';
import { strictManager } from './testing/http-stub-manager.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function clientOf(
  overrides: Partial<Manager> = {},
  mcp?: (request: Request) => Promise<Response>,
) {
  const manager = strictManager(overrides);
  return { manager, client: apiClient(testApp(manager, { mcp })) };
}

function quietErrors() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('the app', () => {
  it('answers /api with JSON that is never cached', async () => {
    const { client } = clientOf({ meta: () => meta() });
    const response = await client.get('/api/meta');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    await expectJson(response, 200, metaSchema);
  });

  it('never caches an answer with no body either', async () => {
    const { client } = clientOf({ deleteSecret: () => undefined });
    const response = await client.delete('/api/secrets/1');
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers an address with no route as a 404 error body', async () => {
    const { client } = clientOf();
    for (const path of ['/api/nothing', '/api', '/nothing', '/api/meta/x']) {
      const response = await client.get(path);
      expect(await expectError(response, 404, 'not_found')).toEqual({
        error: 'not_found',
        message: 'There is nothing at this address.',
      });
    }
    const unknown = await client.get('/api/nothing');
    expect(unknown.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers a method no route has as a 404 too', async () => {
    const { client } = clientOf();
    const response = await client.post('/api/meta', {});
    await expectError(response, 404, 'not_found');
  });

  it('treats a trailing slash like none', async () => {
    const { client } = clientOf({ meta: () => meta() });
    expect((await client.get('/api/meta/')).status).toBe(200);
  });

  it('answers a path with a broken percent escape without failing', async () => {
    const { client } = clientOf();
    const response = await client.get('/api/sessions/%E0%A4%A');
    expect(response.status).toBeLessThan(500);
  });

  it('answers HEAD for a read without a body', async () => {
    const { client } = clientOf({ meta: () => meta() });
    const response = await client.call('HEAD', '/api/meta');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});

describe('the security checks', () => {
  it('come first, before any route, on every address', async () => {
    const mcp = vi.fn(() => Promise.resolve(new Response('mcp')));
    const metaOf = vi.fn(() => meta());
    const manager = strictManager({ meta: metaOf });
    const client = apiClient(testApp(manager, { mcp }));
    for (const path of ['/api/meta', '/mcp', '/api/nothing', '/index.html']) {
      const response = await client.get(path, {
        headers: { Host: 'evil.example:3004' },
      });
      await expectError(response, 403, 'forbidden_host');
    }
    expect(metaOf).not.toHaveBeenCalled();
    expect(mcp).not.toHaveBeenCalled();
  });

  it('refuse a state change from another site before the route reads it', async () => {
    const createSession = vi.fn();
    const { client } = clientOf({ createSession });
    const response = await client.post(
      '/api/sessions',
      {},
      { headers: { Origin: 'http://evil.example' } },
    );
    await expectError(response, 403, 'forbidden_origin');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuse a body that is not JSON', async () => {
    const createSession = vi.fn();
    const { client } = clientOf({ createSession });
    const response = await client.call('POST', '/api/sessions', {
      raw: '{}',
      headers: { 'Content-Type': 'text/plain' },
    });
    await expectError(response, 403, 'forbidden_origin');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('let the page itself through', async () => {
    const { client } = clientOf({ meta: () => meta() });
    const response = await client.get('/api/meta', {
      headers: { Host: 'localhost:3004', Origin: 'http://localhost:3004' },
    });
    expect(response.status).toBe(200);
  });

  it('use the hosts of the configuration', async () => {
    const app = testApp(strictManager({ meta: () => meta() }));
    const response = await app.request('http://sm.example.com/api/meta', {
      headers: { Host: 'sm.example.com' },
    });
    expect(response.status).toBe(403);
  });
});

describe('the error handler', () => {
  it('answers an AppError with its status and body, extras included', async () => {
    const error = new AppError(409, 'ip_in_use', 'The exit IP is in use.', {
      exitIp: '203.0.113.9',
      sessions: [{ id: 1, name: 'a', status: 'running' }],
    });
    const logged = quietErrors();
    const { client } = clientOf({
      meta: () => {
        throw error;
      },
    });
    const response = await client.get('/api/meta');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'ip_in_use',
      message: 'The exit IP is in use.',
      exitIp: '203.0.113.9',
      sessions: [{ id: 1, name: 'a', status: 'running' }],
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([404, 409, 422, 502, 503])(
    'keeps the status %d of an AppError',
    async (status) => {
      const { client } = clientOf({
        meta: () => {
          throw new AppError(status, 'some_code', 'A sentence.');
        },
      });
      expect((await client.get('/api/meta')).status).toBe(status);
    },
  );

  it('answers an AppError thrown by an async method too', async () => {
    const { client } = clientOf({
      createSession: () =>
        Promise.reject(new AppError(409, 'no_free_proxy', 'No free proxy.')),
    });
    const response = await client.post('/api/sessions', {});
    await expectError(response, 409, 'no_free_proxy');
  });

  describe('a request that fails its schema', () => {
    it('is a 422 that names the field and the reason', async () => {
      const { client } = clientOf();
      const response = await client.post('/api/proxies', {
        defaultScheme: 'http',
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: 'validation_error',
        message: 'proxy: Field required',
        issues: [
          { path: ['proxy'], message: 'Field required', code: 'invalid_type' },
        ],
      });
    });

    it('lists every issue, with the numbers of an array in the path', async () => {
      const { client } = clientOf();
      const response = await client.post('/api/secrets', {
        kind: 'diary',
        title: 'x',
        fields: [{ label: 'ok' }, { value: 'no label' }],
      });
      const body = await expectError(response, 422, 'validation_error');
      expect(body.message).toBe(
        'kind: Invalid option: expected one of "personal"|"credentials"|"card"|"note"',
      );
      expect(body.issues).toEqual([
        {
          path: ['kind'],
          message:
            'Invalid option: expected one of "personal"|"credentials"|"card"|"note"',
          code: 'invalid_value',
        },
        {
          path: ['fields', 1, 'label'],
          message: 'Field required',
          code: 'invalid_type',
        },
      ]);
    });

    it('never echoes the rejected value: it could be a proxy with a password', async () => {
      const { client } = clientOf();
      for (const body of [
        { proxy: { url: 'user:hunter2@192.0.2.1:8080' } },
        { proxy: 'user:hunter2@192.0.2.1:8080', defaultScheme: 'hunter2' },
        { proxy: ['hunter2'] },
        ['hunter2'],
      ]) {
        const response = await client.post('/api/proxies', body);
        expect(response.status).toBe(422);
        expect(await response.text()).not.toContain('hunter2');
      }
    });

    it('is a 422 for a body that is not JSON, never echoed either', async () => {
      const { client } = clientOf();
      const response = await client.post('/api/proxies', undefined, {
        raw: '{"proxy": "user:hunter2@1.2.3.4:80"',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: 'validation_error',
        message: 'The request body is not valid JSON.',
        issues: [
          {
            path: [],
            message: 'The request body is not valid JSON.',
            code: 'custom',
          },
        ],
      });
    });

    it('is a 422 for a missing body, worded for the body as a whole', async () => {
      const { client } = clientOf();
      const response = await client.post('/api/proxies');
      expect(await response.json()).toEqual({
        error: 'validation_error',
        message: 'Field required',
        issues: [{ path: [], message: 'Field required', code: 'invalid_type' }],
      });
    });

    it('lists at most 20 issues', async () => {
      const { client } = clientOf();
      const response = await client.post('/api/secrets', {
        kind: 'note',
        title: 'x',
        fields: Array.from({ length: 50 }, () => ({})),
      });
      const body = await expectError(response, 422, 'validation_error');
      expect(body.issues).toHaveLength(20);
    });

    it('is a 422 when a query parameter fails, and says which', async () => {
      const { client } = clientOf();
      const response = await client.get('/api/proxies', {
        query: { limit: 501 },
      });
      const body = await expectError(response, 422, 'validation_error');
      expect(body.message).toBe('limit: Too big: expected number to be <=500');
    });
  });

  describe('anything else', () => {
    it('is a 500 that says nothing of the cause, and is logged', async () => {
      const logged = quietErrors();
      const cause = new Error('connect to user:hunter2@10.0.0.1 failed');
      const { client } = clientOf({
        meta: () => {
          throw cause;
        },
      });
      const response = await client.get('/api/meta');
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'internal_error',
        message: 'Something went wrong.',
      });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith('GET /api/meta failed', cause);
    });

    it('is the same 500 for an async method that rejects', async () => {
      const logged = quietErrors();
      const { client } = clientOf({
        stopSession: () => Promise.reject(new TypeError('x is not a function')),
      });
      const response = await client.post('/api/sessions/1/stop');
      await expectError(response, 500, 'internal_error');
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});

describe('/mcp', () => {
  it('is a 404 when the app has no MCP endpoint', async () => {
    const { client } = clientOf();
    const response = await client.post('/mcp', {});
    await expectError(response, 404, 'not_found');
  });

  it.each(['GET', 'POST', 'DELETE'])(
    'hands a %s to the endpoint as it is and returns its answer',
    async (method) => {
      let seen: Request | undefined;
      let body = '';
      const mcp = vi.fn(async (request: Request) => {
        seen = request;
        body = await request.text();
        return new Response('event: message\n\n', {
          status: 202,
          headers: {
            'Content-Type': 'text/event-stream',
            'Mcp-Session-Id': 'x',
          },
        });
      });
      const { client } = clientOf({}, mcp);
      const response = await client.call(method, '/mcp', {
        body: method === 'POST' ? { jsonrpc: '2.0', id: 1 } : undefined,
        headers: { Accept: 'application/json, text/event-stream' },
      });
      expect(mcp).toHaveBeenCalledTimes(1);
      expect(seen?.method).toBe(method);
      expect(seen?.url).toBe(`http://${TEST_HOST}/mcp`);
      expect(seen?.headers.get('accept')).toBe(
        'application/json, text/event-stream',
      );
      expect(body).toBe(method === 'POST' ? '{"jsonrpc":"2.0","id":1}' : '');
      expect(response.status).toBe(202);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Mcp-Session-Id')).toBe('x');
      expect(await response.text()).toBe('event: message\n\n');
    },
  );

  it('is only /mcp, not what lies under it', async () => {
    const mcp = vi.fn(() => Promise.resolve(new Response('mcp')));
    const { client } = clientOf({}, mcp);
    await expectError(await client.get('/mcp/tools'), 404, 'not_found');
    expect(mcp).not.toHaveBeenCalled();
  });

  it('is a 500 that says nothing when the endpoint fails', async () => {
    const logged = quietErrors();
    const { client } = clientOf({}, () => Promise.reject(new Error('boom')));
    await expectError(await client.get('/mcp'), 500, 'internal_error');
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('is checked for the host and the origin like the API', async () => {
    const mcp = vi.fn(() => Promise.resolve(new Response('mcp')));
    const { client } = clientOf({}, mcp);
    await expectError(
      await client.post(
        '/mcp',
        {},
        { headers: { Origin: 'http://evil.example' } },
      ),
      403,
      'forbidden_origin',
    );
    expect(mcp).not.toHaveBeenCalled();
  });
});

describe('over a real socket', () => {
  let server: Bun.Server<undefined> | undefined;

  afterEach(async () => {
    await server?.stop(true);
    server = undefined;
  });

  /** The app on 127.0.0.1 at a port of the system's choosing; returns its address. */
  function listen(overrides: Partial<Manager> = {}): string {
    let handle: (request: Request) => Response | Promise<Response> = () =>
      new Response('not ready', { status: 503 });
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => handle(request),
    });
    const config = loadConfig(
      { PORT: String(server.port) },
      { distDir: '/nonexistent' },
    );
    handle = createApp({ manager: strictManager(overrides), config }).fetch;
    return `http://127.0.0.1:${server.port}`;
  }

  function chunked(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  it('answers the page’s own requests', async () => {
    const address = listen({ meta: () => meta() });
    const response = await fetch(`${address}/api/meta`);
    await expectJson(response, 200, metaSchema);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('lets a POST without a body through, as the page sends stop and rotate', async () => {
    const address = listen({ checkAllProxies: () => [] });
    const response = await fetch(`${address}/api/proxies/check-all`, {
      method: 'POST',
    });
    expect(response.status).toBe(202);
  });

  it('lets a JSON body through, also when it arrives in chunks', async () => {
    const importProxies = vi.fn<Manager['importProxies']>(() => importResult());
    const address = listen({ importProxies });
    const response = await fetch(`${address}/api/proxies/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: chunked('{"text":"192.0.2.1:8080"}'),
    });
    expect(response.status).toBe(200);
    expect(importProxies).toHaveBeenCalledExactlyOnceWith('192.0.2.1:8080', {
      defaultScheme: 'http',
    });
  });

  it('refuses a body over 1 MiB with a 413, announced or in chunks, and does not run the route', async () => {
    const importProxies = vi.fn<Manager['importProxies']>(() => importResult());
    const address = listen({ importProxies });
    const post = (body: BodyInit) =>
      fetch(`${address}/api/proxies/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    const big = `{"text":"${'x'.repeat(2 * 1024 * 1024)}"}`;
    expect(await expectError(await post(big), 413, 'validation_error')).toEqual(
      {
        error: 'validation_error',
        message: 'The request body is larger than 1048576 bytes.',
      },
    );
    await expectError(await post(chunked(big)), 413, 'validation_error');
    expect(importProxies).not.toHaveBeenCalled();
    // The server still answers.
    const after = await fetch(`${address}/api/meta`);
    expect(after.status).not.toBe(413);
  });

  it('takes a body just under 1 MiB', async () => {
    const importProxies = vi.fn<Manager['importProxies']>(() => importResult());
    const address = listen({ importProxies });
    const text = 'x'.repeat(MAX_PROXY_IMPORT);
    const response = await fetch(`${address}/api/proxies/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    expect(response.status).toBe(200);
    expect(importProxies).toHaveBeenCalledTimes(1);
  });

  it('refuses another host name, a foreign origin and a body that is not JSON', async () => {
    const importProxies = vi.fn<Manager['importProxies']>(() => importResult());
    const address = listen({ meta: () => meta(), importProxies });
    const foreignHost = await fetch(`${address}/api/meta`, {
      headers: { Host: 'evil.example' },
    });
    await expectError(foreignHost, 403, 'forbidden_host');

    const post = (init: RequestInit) =>
      fetch(`${address}/api/proxies/import`, { method: 'POST', ...init });
    const body = '{"text":"192.0.2.1:8080"}';
    const foreignOrigin = await post({
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.example',
      },
      body,
    });
    await expectError(foreignOrigin, 403, 'forbidden_origin');
    const plain = await post({
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    await expectError(plain, 403, 'forbidden_origin');
    const plainChunks = await post({
      headers: { 'Content-Type': 'text/plain' },
      body: chunked(body),
    });
    await expectError(plainChunks, 403, 'forbidden_origin');
    expect(importProxies).not.toHaveBeenCalled();
  });
});
