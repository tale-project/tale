import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { CookieJar } from '../../src/client/cookies.ts';
import { HttpClient, createAgent, withQuery } from '../../src/client/http.ts';
import { MetricsRegistry } from '../../src/metrics/registry.ts';
import { sleep, startServer, unusedPort } from './test-server.ts';
import type { TestServer } from './test-server.ts';

const agent = createAgent({ keepAliveTimeoutMs: 1_000 });
let server: TestServer;

beforeAll(async () => {
  server = await startServer(async (request, response) => {
    const path = request.url.split('?')[0];
    switch (path) {
      case '/prefix/api/ok':
        response.setHeader('content-type', 'application/json');
        response.setHeader('set-cookie', [
          'a=1; Path=/; HttpOnly',
          'b=2; Path=/; Max-Age=60',
        ]);
        response.end(JSON.stringify({ hello: 'world', url: request.url }));
        return;
      case '/prefix/api/echo':
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({ headers: request.headers, body: request.body }),
        );
        return;
      case '/prefix/api/missing':
        response.statusCode = 404;
        response.end('no such thing');
        return;
      case '/prefix/api/broken':
        response.statusCode = 500;
        response.end('{"error":"database is on fire"}');
        return;
      case '/prefix/api/etag': {
        const etag = '"v1"';
        if (request.headers['if-none-match'] === etag) {
          response.statusCode = 304;
          response.end();
          return;
        }
        response.setHeader('etag', etag);
        response.setHeader('content-type', 'application/json');
        response.end('{"items":[1,2,3]}');
        return;
      }
      case '/prefix/api/slow':
        await sleep(1_000);
        response.end('late');
        return;
      case '/prefix/api/text':
        response.end('not json');
        return;
      default:
        response.statusCode = 418;
        response.end();
    }
  });
});

afterAll(async () => {
  await server.close();
  await agent.destroy();
});

function client(
  metrics: MetricsRegistry,
  extra: { cookies?: CookieJar; forwardedFor?: string } = {},
): HttpClient {
  return new HttpClient({
    baseUrl: `${server.url}/prefix/`,
    agent,
    metrics,
    defaultHeaders: { 'user-agent': 'tale-load-test' },
    ...extra,
  });
}

describe('HttpClient', () => {
  test('a success returns the body and records timing and status', async () => {
    const metrics = new MetricsRegistry();
    const cookies = new CookieJar();
    const response = await client(metrics, { cookies }).request<{
      hello: string;
      url: string;
    }>({
      method: 'GET',
      path: '/api/ok',
      query: { orgId: 'org 1', tags: ['a', 'b'], skip: undefined },
      name: 'GET /api/ok',
    });
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.ms).toBeGreaterThan(0);
    expect(response.json()?.hello).toBe('world');
    expect(response.json()?.url).toBe(
      '/prefix/api/ok?orgId=org%201&tags=a&tags=b',
    );
    expect(response.header('content-type')).toBe('application/json');
    expect(cookies.header()).toBe('a=1; b=2');
    expect(metrics.histogram('GET /api/ok')?.count).toBe(1);
    expect(metrics.snapshot().statuses['GET /api/ok']).toEqual({ '200': 1 });
    expect(metrics.errorCount('GET /api/ok')).toBe(0);
  });

  test('non-GET requests carry Origin, the JSON type, cookies and X-Forwarded-For', async () => {
    const metrics = new MetricsRegistry();
    const cookies = new CookieJar();
    cookies.set('better-auth.session_token', 'tok.sig');
    const http = client(metrics, { cookies, forwardedFor: '10.1.2.3' });
    const post = await http.request<{
      headers: Record<string, string>;
      body: string;
    }>({
      method: 'POST',
      path: '/api/echo',
      json: { name: 'x' },
      name: 'POST /api/echo',
    });
    const seen = post.json();
    expect(seen?.headers.origin).toBe(server.url);
    expect(seen?.headers['content-type']).toBe('application/json');
    expect(seen?.headers.cookie).toBe('better-auth.session_token=tok.sig');
    expect(seen?.headers['x-forwarded-for']).toBe('10.1.2.3');
    expect(seen?.headers['user-agent']).toBe('tale-load-test');
    expect(seen?.body).toBe('{"name":"x"}');

    const get = await http.request<{ headers: Record<string, string> }>({
      method: 'GET',
      path: '/api/echo',
      headers: { 'x-extra': 'yes' },
      name: 'GET /api/echo',
    });
    expect(get.json()?.headers.origin).toBeUndefined();
    expect(get.json()?.headers['x-extra']).toBe('yes');
  });

  test('an expected 404 is a success and records no error', async () => {
    const metrics = new MetricsRegistry();
    const response = await client(metrics).request({
      method: 'GET',
      path: '/api/missing',
      name: 'GET /api/missing',
      expect: [200, 404],
    });
    expect(response.status).toBe(404);
    expect(response.ok).toBe(true);
    expect(response.errorKind).toBeUndefined();
    expect(metrics.errorCount('GET /api/missing')).toBe(0);
    expect(metrics.snapshot().statuses['GET /api/missing']).toEqual({
      '404': 1,
    });
  });

  test('an unexpected 500 records an error with a body sample', async () => {
    const metrics = new MetricsRegistry();
    const response = await client(metrics).request({
      method: 'DELETE',
      path: '/api/broken',
      name: 'DELETE /api/broken',
    });
    expect(response.status).toBe(500);
    expect(response.ok).toBe(false);
    expect(response.errorKind).toBe('http_500');
    const error = metrics.snapshot().errors['DELETE /api/broken'].http_500;
    expect(error.count).toBe(1);
    expect(error.samples[0]).toContain('database is on fire');
    expect(error.samples[0]).toContain('/prefix/api/broken');
  });

  test('an ETag revalidation answers a 304 from the cache', async () => {
    const metrics = new MetricsRegistry();
    const http = client(metrics);
    const first = await http.request<{ items: number[] }>({
      method: 'GET',
      path: '/api/etag',
      name: 'GET /api/etag',
      etag: true,
    });
    expect(first.status).toBe(200);
    expect(first.cacheHit).toBe(false);
    const before = server.requests.length;
    const second = await http.request<{ items: number[] }>({
      method: 'GET',
      path: '/api/etag',
      name: 'GET /api/etag',
      etag: true,
    });
    expect(server.requests[before].headers['if-none-match']).toBe('"v1"');
    expect(second.status).toBe(304);
    expect(second.ok).toBe(true);
    expect(second.cacheHit).toBe(true);
    expect(second.json()?.items).toEqual([1, 2, 3]);
    expect(metrics.snapshot().statuses['GET /api/etag']).toEqual({
      '200': 1,
      '304': 1,
    });

    http.clearEtags();
    const third = await http.request({
      method: 'GET',
      path: '/api/etag',
      name: 'GET /api/etag',
      etag: true,
    });
    expect(third.status).toBe(200);
  });

  test('a refused connection returns status 0 and net_ECONNREFUSED', async () => {
    const metrics = new MetricsRegistry();
    const port = await unusedPort();
    const http = new HttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      agent,
      metrics,
    });
    const response = await http.request({
      method: 'GET',
      path: '/x',
      name: 'GET /x',
    });
    expect(response.status).toBe(0);
    expect(response.ok).toBe(false);
    expect(response.errorKind).toBe('net_ECONNREFUSED');
    expect(response.text).toBe('');
    expect(metrics.errorCount('GET /x', 'net_ECONNREFUSED')).toBe(1);
    expect(metrics.snapshot().statuses['GET /x']).toEqual({ '0': 1 });
    expect(metrics.histogram('GET /x')?.count).toBe(1);
  });

  test('a request past its deadline returns status 0 and net_TIMEOUT', async () => {
    const metrics = new MetricsRegistry();
    const started = performance.now();
    const response = await client(metrics).request({
      method: 'GET',
      path: '/api/slow',
      name: 'GET /api/slow',
      timeoutMs: 50,
    });
    expect(performance.now() - started).toBeLessThan(900);
    expect(response.status).toBe(0);
    expect(response.errorKind).toBe('net_TIMEOUT');
    expect(metrics.errorCount('GET /api/slow', 'net_TIMEOUT')).toBe(1);
  });

  test('json() is undefined for a non-JSON body and says why', async () => {
    const response = await client(new MetricsRegistry()).request({
      method: 'GET',
      path: '/api/text',
      name: 'GET /api/text',
    });
    expect(response.text).toBe('not json');
    expect(response.json()).toBeUndefined();
    expect(response.jsonError).toBeString();
  });
});

describe('withQuery', () => {
  test('appends to a path that already has a query', () => {
    expect(withQuery('/a?x=1', { orgId: 'o', n: 2, flag: true })).toBe(
      '/a?x=1&orgId=o&n=2&flag=true',
    );
    expect(withQuery('/a', { skip: null })).toBe('/a');
    expect(withQuery('/a', undefined)).toBe('/a');
  });
});
