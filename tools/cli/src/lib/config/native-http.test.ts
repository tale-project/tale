import { describe, expect, test } from 'bun:test';

import {
  boundedNativeJson,
  createNativeHttp,
  type NativeHttpOptions,
} from './native-http';
import { NativeRequestError } from './releases/model';

const options = {
  url: 'http://127.0.0.1:3005',
  origin: 'https://native.example.invalid',
  orgId: 'organization-one',
  cookie: 'session=synthetic-http-contract',
};

async function expectFailure(pending: Promise<unknown>, message: string) {
  let caught: unknown;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught instanceof Error ? caught.message : '').toContain(message);
}

describe('shared native HTTP boundary', () => {
  test('uses exact cookie/Origin, one org scope, API JSON and redirect refusal', async () => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const client = createNativeHttp({
      ...options,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ accepted: true });
      },
    });
    const body = { value: 'Grüezi 🌍', expectedHash: null };
    expect(
      await client.request(
        '/api/app/example?orgId=wrong&orgId=also-wrong&includeHash=1',
        { method: 'POST', body },
      ),
    ).toEqual({ accepted: true });
    const call = calls[0];
    expect(call.url.origin).toBe(options.url);
    expect(call.url.searchParams.getAll('orgId')).toEqual([options.orgId]);
    expect(call.url.searchParams.get('includeHash')).toBe('1');
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(call.init.headers).get('cookie')).toBe(options.cookie);
    expect(new Headers(call.init.headers).get('origin')).toBe(options.origin);
    expect(new Headers(call.init.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(typeof call.init.body).toBe('string');
    expect(
      JSON.parse(typeof call.init.body === 'string' ? call.init.body : ''),
    ).toEqual(body);
    expect(call.url.href).not.toContain(options.cookie);
  });

  test.each([
    'https://outside.example.invalid/api/app/example',
    '//outside.example.invalid/api/app/example',
    '/outside',
    '/api/../outside',
    '/api/%2e%2e/outside',
    '/api/..\\outside',
    '/api/app/example#private-fragment',
    'api/app/example',
  ])('refuses a request outside the API before fetch: %s', async (endpoint) => {
    let calls = 0;
    const client = createNativeHttp({
      ...options,
      fetchImpl: async () => {
        calls++;
        return Response.json({});
      },
    });
    await expectFailure(
      client.request(endpoint),
      'must stay inside the Tale API',
    );
    expect(calls).toBe(0);
  });

  test.each([
    { url: 'not-a-url' },
    { url: 'https://user:password@native.example.invalid' },
    { url: 'https://native.example.invalid/path' },
    { url: 'https://native.example.invalid?query=1' },
    { url: 'https://native.example.invalid#fragment' },
    { url: 'http://10.0.0.2' },
    { url: 'http://localhost.outside.example.invalid' },
    { url: 'ftp://native.example.invalid' },
    { origin: 'http://localhost' },
    { origin: 'https://native.example.invalid/path' },
    { origin: 'https://user:password@native.example.invalid' },
    { origin: 'https://native.example.invalid?private=1' },
    { cookie: '' },
    { cookie: 'session=value\r\nother: value' },
    { cookie: 'x'.repeat(16_385) },
    { orgId: '' },
    { orgId: 'organization\n' },
    { orgId: 'x'.repeat(129) },
  ])(
    'rejects invalid native URL, Origin or credential input before transport (%#)',
    (patch) => {
      let calls = 0;
      expect(() =>
        createNativeHttp({
          ...options,
          ...patch,
          fetchImpl: async () => {
            calls++;
            return Response.json({});
          },
        }),
      ).toThrow();
      expect(calls).toBe(0);
    },
  );

  test.each([
    'http://localhost:3005',
    'http://[::1]:3005',
    'https://native.example.invalid',
  ])('supports a permitted origin: %s', async (url) => {
    const client = createNativeHttp({
      ...options,
      url,
      fetchImpl: async () => Response.json(null),
    });
    expect(await client.request('/api/auth/get-session')).toBeNull();
  });

  test('supports same public HTTPS origin without an override and raw ZIP uploads', async () => {
    let observed: RequestInit | undefined;
    const client = createNativeHttp({
      ...options,
      url: options.origin + '/',
      origin: undefined,
      fetchImpl: async (_url, init) => {
        observed = init;
        return Response.json({});
      },
    });
    const body = Buffer.from([0x50, 0x4b, 0, 1, 2]);
    await client.request('/api/app/automations/import', {
      method: 'POST',
      raw: true,
      body,
    });
    expect(observed?.body).toEqual(body);
    expect(new Headers(observed?.headers).get('content-type')).toBe(
      'application/zip',
    );
    expect(client.origin).toBe(options.origin);
  });

  test('HTTP and transport failures never expose headers, native bodies or thrown diagnostics', async () => {
    const privateBody = 'private-native-config-response';
    for (const kind of ['http', 'transport']) {
      let cancelled = false;
      const fetchImpl: NativeHttpOptions['fetchImpl'] = async () => {
        if (kind === 'transport')
          throw new Error(`${options.cookie} ${privateBody}`);
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 503 },
        );
      };
      const client = createNativeHttp({ ...options, fetchImpl });
      let caught: unknown;
      try {
        await client.request('/api/app/example?private=value', {
          method: 'POST',
          body: { privateBody },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NativeRequestError);
      expect(String(caught)).toContain(
        kind === 'http' ? 'HTTP 503' : 'response may have been lost',
      );
      expect(String(caught)).not.toContain(options.cookie);
      expect(String(caught)).not.toContain(privateBody);
      expect(String(caught)).not.toContain('private=value');
      if (kind === 'http') expect(cancelled).toBe(true);
    }
  });

  test('404 is only nullable when explicitly requested and cancels unread bodies', async () => {
    let cancelled = 0;
    const client = createNativeHttp({
      ...options,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { status: 404 },
        ),
    });
    expect(
      await client.request('/api/app/example', { allowNotFound: true }),
    ).toBeNull();
    await expectFailure(client.request('/api/app/example'), 'HTTP 404');
    expect(cancelled).toBe(2);
  });

  test('the real fetch refuses an HTTP redirect without replaying the request at its destination', async () => {
    const reached: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        reached.push(path);
        return path === '/api/redirect'
          ? new Response(null, {
              status: 307,
              headers: { location: '/api/destination?private=value' },
            })
          : Response.json({ unexpected: true });
      },
    });
    try {
      const client = createNativeHttp({
        ...options,
        url: `http://127.0.0.1:${server.port}`,
      });
      await expectFailure(
        client.request('/api/redirect', {
          method: 'POST',
          body: { private: 'synthetic-request' },
        }),
        'transport failed',
      );
      expect(reached).toEqual(['/api/redirect']);
    } finally {
      await server.stop(true);
    }
  });
});

describe('bounded native JSON', () => {
  test('decodes split multibyte UTF-8 only after enforcing the exact byte bound', async () => {
    const value = { greeting: 'Grüezi 🌍' };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const response = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      );
    expect(await boundedNativeJson(response(), bytes.byteLength)).toEqual(
      value,
    );
    await expectFailure(
      boundedNativeJson(response(), bytes.byteLength - 1),
      'invalid or oversized JSON',
    );
  });

  test('missing, malformed, invalid UTF-8 and failing response streams have sanitized errors', async () => {
    const privateBody = 'private-broken-response';
    const responses = [
      new Response(null),
      new Response(`{"private":"${privateBody}`),
      new Response(Uint8Array.from([0x22, 0xc3, 0x28, 0x22])),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(privateBody));
          },
        }),
      ),
    ];
    for (const response of responses) {
      let caught: unknown;
      try {
        await boundedNativeJson(response);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NativeRequestError);
      expect(String(caught)).toContain('invalid or oversized JSON');
      expect(String(caught)).not.toContain(privateBody);
    }
  });

  test('oversized streamed responses are cancelled even when Content-Length understates bytes', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(33));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-length': '1' } },
    );
    await expectFailure(
      boundedNativeJson(response, 32),
      'invalid or oversized JSON',
    );
    expect(cancelled).toBe(true);
  });
});
