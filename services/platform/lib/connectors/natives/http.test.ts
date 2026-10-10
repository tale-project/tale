import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SafeFetchError,
  setSafeFetchResolverForTests,
  type SafeFetchOptions,
  type SafeFetchResponse,
} from '../../net/safe-fetch';
import type { NativeConnectorContext } from '../dispatcher';
import { AtOnceGate, httpNatives, type HttpNativeDeps } from './http';

const ORG = 'org_1';
const TOKEN = 'tok_live_9f8e7d6c5b4a';

interface Credential {
  readonly authMethod: string;
  readonly secrets?: Record<string, string>;
  readonly config?: Record<string, string | number | boolean>;
}

/** A native context acting as `credential`, or as none. */
function context(credential?: Credential): NativeConnectorContext {
  const secrets = credential?.secrets ?? {};
  const refuse = () =>
    Promise.reject(new Error('no live host in the HTTP native'));
  return {
    secrets: { get: (name) => secrets[name] ?? '' },
    idempotencyKey: 'key_1',
    config: credential?.config ?? {},
    organizationId: ORG,
    credentialId: credential === undefined ? 'none' : 'cred_1',
    authMethod: credential?.authMethod ?? 'none',
    http: {
      get: refuse,
      post: refuse,
      put: refuse,
      patch: refuse,
      delete: refuse,
    },
    base64Encode: (value) => Buffer.from(value, 'utf8').toString('base64'),
    base64Decode: (value) => Buffer.from(value, 'base64').toString('utf8'),
  };
}

const BEARER: Credential = {
  authMethod: 'bearer',
  secrets: { token: TOKEN },
  config: { baseUrl: 'https://api.example.com/v2' },
};

interface Answer {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly finalUrl?: string;
}

/** An outbound client that answers `answer` and keeps every request. */
function client(answer: Answer = {}) {
  const calls: Array<{ url: string; options: SafeFetchOptions }> = [];
  const fetch = vi.fn(
    async (
      url: string,
      options: SafeFetchOptions,
    ): Promise<SafeFetchResponse> => {
      calls.push({ url, options });
      return {
        status: answer.status ?? 200,
        statusText: '',
        headers: new Headers(
          answer.headers ?? { 'content-type': 'application/json' },
        ),
        body: answer.body ?? '{"orders":[]}',
        finalUrl: answer.finalUrl ?? url,
      };
    },
  );
  return { fetch, calls };
}

function natives(deps: HttpNativeDeps) {
  return httpNatives({
    privateHostsAllowed: () => false,
    atOnce: new AtOnceGate(10),
    ...deps,
  });
}

/** The cause a refusal names, for a call expected to fail. */
async function causeOf(call: Promise<unknown>) {
  const error: unknown = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (
    typeof error !== 'object' ||
    error === null ||
    !('failure' in error) ||
    typeof error.failure !== 'object'
  ) {
    throw new Error(`no failure cause on ${String(error)}`);
  }
  return error.failure;
}

afterEach(() => {
  setSafeFetchResolverForTests(null);
});

describe('a call without a credential [CONN-R15]', () => {
  it('calls a public HTTPS address with no credential at all', async () => {
    const api = client({
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=abc',
        etag: '"v1"',
        'x-ratelimit-remaining': '41',
      },
      body: '{"orders":[{"id":1}]}',
    });
    const answer = await natives({ fetch: api.fetch })['http.get'](
      { url: 'https://api.example.com/orders', query: { status: 'open' } },
      context(),
    );
    expect(answer).toEqual({
      status: 200,
      ok: true,
      headers: {
        'content-type': 'application/json',
        etag: '"v1"',
        'x-ratelimit-remaining': '41',
      },
      body: { orders: [{ id: 1 }] },
    });
    const [request] = api.calls;
    expect(request?.url).toBe('https://api.example.com/orders?status=open');
    expect(request?.options).toMatchObject({
      method: 'GET',
      credentialless: true,
      httpsOnly: true,
      allowPrivateAddresses: false,
    });
    expect(request?.options.allowedHosts).toBeUndefined();
    expect(request?.options.headers).toEqual({});
  });

  it('refuses a path, which only a credential gives an address', async () => {
    const api = client();
    await expect(
      causeOf(
        natives({ fetch: api.fetch })['http.get'](
          { url: '/orders' },
          context(),
        ),
      ),
    ).resolves.toEqual({ reason: 'HTTP_URL_INVALID', params: { why: 'path' } });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('refuses plain http to a public host', async () => {
    const api = client();
    await expect(
      causeOf(
        natives({ fetch: api.fetch })['http.get'](
          { url: 'http://api.example.com/orders' },
          context(),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_BLOCKED_HOST',
      params: { host: 'api.example.com', why: 'plaintext' },
    });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('reaches a private address only where its host admits private hosts', async () => {
    const refused = client();
    await expect(
      causeOf(
        natives({ fetch: refused.fetch })['http.get'](
          { url: 'http://10.0.0.5:8080/health' },
          context(),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_BLOCKED_HOST',
      params: { host: '10.0.0.5:8080', why: 'private' },
    });
    expect(refused.fetch).not.toHaveBeenCalled();

    const admitted = client();
    await natives({ fetch: admitted.fetch, privateHostsAllowed: () => true })[
      'http.get'
    ]({ url: 'http://10.0.0.5:8080/health' }, context());
    expect(admitted.calls[0]?.options).toMatchObject({
      allowPrivateAddresses: true,
      httpsOnly: false,
      credentialless: true,
    });
  });

  it.each([
    'http://169.254.169.254/latest',
    'https://metadata.google.internal/x',
  ])(
    'never calls a cloud metadata address, private hosts admitted or not (%s)',
    async (url) => {
      const api = client();
      const failure = await causeOf(
        natives({ fetch: api.fetch, privateHostsAllowed: () => true })[
          'http.get'
        ]({ url }, context()),
      );
      expect(failure).toMatchObject({
        reason: 'HTTP_BLOCKED_HOST',
        params: { why: 'metadata' },
      });
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );

  it('refuses a URL that carries a user name or a password, and one that is not http', async () => {
    const api = client();
    const call = natives({ fetch: api.fetch })['http.get'];
    await expect(
      causeOf(call({ url: 'https://ada:pw@api.example.com/' }, context())),
    ).resolves.toEqual({
      reason: 'HTTP_URL_INVALID',
      params: { why: 'userinfo' },
    });
    await expect(
      causeOf(call({ url: 'ftp://files.example.com/a' }, context())),
    ).resolves.toEqual({
      reason: 'HTTP_URL_INVALID',
      params: { why: 'scheme' },
    });
    await expect(
      causeOf(call({ url: 'not an address' }, context())),
    ).resolves.toEqual({ reason: 'HTTP_URL_INVALID', params: { why: 'url' } });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('refuses Authorization and Cookie from the step itself [CONN-R17]', async () => {
    const api = client();
    const call = natives({ fetch: api.fetch })['http.get'];
    for (const header of ['Authorization', 'cookie', 'Proxy-Authorization']) {
      await expect(
        causeOf(
          call(
            { url: 'https://api.example.com/', headers: { [header]: 'x' } },
            context(),
          ),
        ),
      ).resolves.toEqual({
        reason: 'HTTP_HEADER_RESERVED',
        params: { header },
      });
    }
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe('a call with a credential', () => {
  it('signs with it and places a path under its base URL [CONN-R16]', async () => {
    const api = client();
    await natives({ fetch: api.fetch })['http.get'](
      { url: '/orders', query: { page: 2 } },
      context(BEARER),
    );
    const [request] = api.calls;
    expect(request?.url).toBe('https://api.example.com/v2/orders?page=2');
    expect(request?.options).toMatchObject({
      allowedHosts: ['api.example.com'],
      httpsOnly: true,
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(request?.options.credentialless).toBeUndefined();
  });

  it.each([
    ['another host', 'https://evil.example.com/v2/orders'],
    ['a sibling path', 'https://api.example.com/v20/orders'],
    ['a path that climbs out', '/../admin'],
    ['an encoded climb', '/%2e%2e/admin'],
    ['plain http to the same host', 'http://api.example.com/v2/orders'],
  ])(
    'refuses an address outside the base: %s [CONN-R16]',
    async (_case, url) => {
      const api = client();
      await expect(
        causeOf(
          natives({ fetch: api.fetch })['http.get']({ url }, context(BEARER)),
        ),
      ).resolves.toMatchObject({
        reason: 'HTTP_OFF_ORIGIN',
        params: { baseUrl: 'https://api.example.com/v2' },
      });
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );

  it('accepts a full address under the base', async () => {
    const api = client();
    await natives({ fetch: api.fetch })['http.get'](
      { url: 'https://api.example.com/v2/orders/7' },
      context(BEARER),
    );
    expect(api.calls[0]?.url).toBe('https://api.example.com/v2/orders/7');
  });

  it('refuses the answer of a redirect chain that ended outside the base [CONN-R16]', async () => {
    const api = client({ finalUrl: 'https://api.example.com/admin/keys' });
    await expect(
      causeOf(
        natives({ fetch: api.fetch })['http.get'](
          { url: '/orders' },
          context(BEARER),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_OFF_ORIGIN',
      params: {
        target: 'https://api.example.com/admin/keys',
        baseUrl: 'https://api.example.com/v2',
      },
    });
  });

  it('refuses a base URL that is not an address, and one on a public host over plain http', async () => {
    const api = client();
    const call = natives({ fetch: api.fetch })['http.get'];
    await expect(
      causeOf(
        call(
          { url: '/orders' },
          context({ ...BEARER, config: { baseUrl: 'api.example.com' } }),
        ),
      ),
    ).resolves.toEqual({ reason: 'HTTP_URL_INVALID', params: { why: 'base' } });
    await expect(
      causeOf(
        call(
          { url: '/orders' },
          context({ ...BEARER, config: { baseUrl: 'http://api.example.com' } }),
        ),
      ),
    ).resolves.toMatchObject({
      reason: 'HTTP_BLOCKED_HOST',
      params: { why: 'plaintext' },
    });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('puts an API key in the header the credential names, and refuses that header from the step', async () => {
    const credential: Credential = {
      authMethod: 'api-key',
      secrets: { token: TOKEN },
      config: {
        baseUrl: 'https://api.example.com',
        apiKeyHeader: 'X-Shop-Key',
      },
    };
    const api = client();
    const call = natives({ fetch: api.fetch })['http.get'];
    await call({ url: '/orders' }, context(credential));
    expect(api.calls[0]?.options.headers).toEqual({ 'X-Shop-Key': TOKEN });
    await expect(
      causeOf(
        call(
          { url: '/orders', headers: { 'x-shop-key': 'mine' } },
          context(credential),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_HEADER_RESERVED',
      params: { header: 'x-shop-key' },
    });
  });

  it('signs with a user name and password, and never hands the password back', async () => {
    const credential: Credential = {
      authMethod: 'basic',
      secrets: { username: 'ada', password: 'correct-horse-battery' },
      config: { baseUrl: 'https://api.example.com' },
    };
    const api = client({
      headers: { 'content-type': 'text/plain' },
      body: 'you sent correct-horse-battery',
    });
    const answer = await natives({ fetch: api.fetch })['http.get'](
      { url: '/whoami' },
      context(credential),
    );
    const encoded = Buffer.from('ada:correct-horse-battery').toString('base64');
    expect(api.calls[0]?.options.headers).toEqual({
      Authorization: `Basic ${encoded}`,
    });
    expect(answer).toMatchObject({ body: 'you sent [redacted]' });
  });

  it('scrubs the credential from every answer and failure it hands back [CONN-R17]', async () => {
    const echo = client({
      headers: {
        'content-type': 'application/json',
        location: `https://api.example.com/v2/next?key=${TOKEN}`,
      },
      body: JSON.stringify({ seen: `Bearer ${TOKEN}` }),
    });
    const answer = await natives({ fetch: echo.fetch })['http.get'](
      { url: '/echo' },
      context(BEARER),
    );
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(answer).toMatchObject({ body: { seen: 'Bearer [redacted]' } });

    const refused = client({ status: 401, body: `bad token ${TOKEN}` });
    const failure = await causeOf(
      natives({ fetch: refused.fetch })['http.get'](
        { url: '/echo' },
        context(BEARER),
      ),
    );
    expect(JSON.stringify(failure)).not.toContain(TOKEN);
  });
});

describe('the answer', () => {
  it('fails a status outside 200–299 unless the step lists it', async () => {
    const missing = client({ status: 404, body: 'no such order' });
    await expect(
      causeOf(
        natives({ fetch: missing.fetch })['http.get'](
          { url: 'https://api.example.com/orders/9' },
          context(),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_STATUS',
      params: {
        status: 404,
        method: 'GET',
        host: 'api.example.com',
        detail: 'no such order',
      },
    });
    const listed = await natives({ fetch: client({ status: 404 }).fetch })[
      'http.get'
    ](
      { url: 'https://api.example.com/orders/9', okStatuses: [404] },
      context(),
    );
    expect(listed).toMatchObject({ status: 404, ok: false });
  });

  it('reads JSON by its content type and text otherwise, and refuses text where JSON is asked for', async () => {
    const page = client({
      headers: { 'content-type': 'text/html' },
      body: '<p>hi</p>',
    });
    const call = natives({ fetch: page.fetch })['http.get'];
    await expect(
      call({ url: 'https://example.com/' }, context()),
    ).resolves.toMatchObject({ body: '<p>hi</p>' });
    await expect(
      causeOf(
        call({ url: 'https://example.com/', responseType: 'json' }, context()),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_NOT_JSON',
      params: { host: 'example.com', contentType: 'text/html' },
    });
    const empty = await natives({
      fetch: client({ status: 204, body: '' }).fetch,
    })['http.get']({ url: 'https://example.com/' }, context());
    expect(empty).toMatchObject({ status: 204, ok: true, body: null });
  });

  it.each([
    [
      new SafeFetchError('timeout', 'Request exceeded 2000ms'),
      {
        reason: 'HTTP_TIMEOUT',
        params: { method: 'GET', host: 'api.example.com', limitMs: 2000 },
      },
    ],
    [
      new SafeFetchError('response_too_large', 'too big'),
      { reason: 'HTTP_TOO_LARGE', params: { host: 'api.example.com' } },
    ],
    [
      new SafeFetchError('network_error', 'fetch failed: ECONNREFUSED'),
      {
        reason: 'HTTP_UNREACHABLE',
        params: {
          host: 'api.example.com',
          detail: 'network_error: fetch failed: ECONNREFUSED',
        },
      },
    ],
    [
      new SafeFetchError(
        'private_ip',
        'Host resolves to private/loopback address: api.example.com',
      ),
      {
        reason: 'HTTP_BLOCKED_HOST',
        params: { host: 'api.example.com', why: 'private' },
      },
    ],
  ])(
    'names the cause of a request that got no answer (%s)',
    async (error, cause) => {
      const fetch = vi.fn(async () => {
        throw error;
      });
      await expect(
        causeOf(
          natives({ fetch })['http.get'](
            { url: 'https://api.example.com/', timeoutMs: 2000 },
            context(),
          ),
        ),
      ).resolves.toEqual(cause);
    },
  );
});

describe('sending', () => {
  it('sends a JSON value as JSON and a string as it is', async () => {
    const api = client();
    const send = natives({ fetch: api.fetch })['http.send'];
    await send(
      {
        url: 'https://api.example.com/orders',
        method: 'POST',
        body: { item: 'A-1' },
      },
      context(),
    );
    expect(api.calls[0]?.options).toMatchObject({
      method: 'POST',
      body: '{"item":"A-1"}',
      headers: { 'Content-Type': 'application/json' },
    });
    await send(
      {
        url: 'https://api.example.com/notes',
        method: 'PUT',
        body: 'hello',
        contentType: 'text/markdown',
      },
      context(),
    );
    expect(api.calls[1]?.options).toMatchObject({
      method: 'PUT',
      body: 'hello',
      headers: { 'Content-Type': 'text/markdown' },
    });
  });
});

describe('the organization’s lane [CONN-R18]', () => {
  it('refuses a call once the minute’s budget is spent, before any request', async () => {
    const api = client();
    await expect(
      causeOf(
        natives({ fetch: api.fetch, budget: { charge: async () => false } })[
          'http.get'
        ]({ url: 'https://api.example.com/' }, context()),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_RATE_LIMITED',
      params: { perMinute: 120, atOnce: 10 },
    });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('runs a limited number of calls at once; the next waits for a slot, or gives up', async () => {
    const gate = new AtOnceGate(1);
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fetch = vi.fn(async (url: string) => {
      await held;
      return {
        status: 200,
        statusText: '',
        headers: new Headers(),
        body: '',
        finalUrl: url,
      };
    });
    const call = natives({ fetch, atOnce: gate })['http.get'];
    const first = call({ url: 'https://api.example.com/a' }, context());
    await expect(
      causeOf(
        call({ url: 'https://api.example.com/b', timeoutMs: 1000 }, context()),
      ),
    ).resolves.toMatchObject({ reason: 'HTTP_RATE_LIMITED' });
    const second = call(
      { url: 'https://api.example.com/c', timeoutMs: 5000 },
      context(),
    );
    finish();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('with the platform’s outbound client', () => {
  it('refuses a public name whose address is private, before any request leaves', async () => {
    setSafeFetchResolverForTests(() =>
      Promise.resolve([{ address: '10.0.0.5', family: 4 as const }]),
    );
    await expect(
      causeOf(
        httpNatives({ privateHostsAllowed: () => false })['http.get'](
          { url: 'https://api.example.com/orders' },
          context(),
        ),
      ),
    ).resolves.toEqual({
      reason: 'HTTP_BLOCKED_HOST',
      params: { host: 'api.example.com', why: 'private' },
    });
  });
});
