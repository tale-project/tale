import { createServer } from 'node:http';

import { isPrivateIp } from '@tale/shared/net/private-ip';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { safeFetch } from '../lib/net/safe-fetch';
import {
  getProviderCatalog,
  invalidateCatalogFetchCache,
} from './core/lib/providers/catalog_fetch';
import { loadProviderDefinitions } from './core/lib/providers/load_system_config';
import {
  ITEST_FIXTURE_ADDRESS,
  ITEST_VENDOR_HOSTS,
  itestResolve,
  routeVendorFetch,
  startItestVendorStub,
  vendorAnswer,
  type ItestVendorStub,
  type OffBoxRequest,
} from './integration-vendor-stub';

function shippedProvider(name: string) {
  const provider = loadProviderDefinitions().find(
    (entry) => entry.name === name,
  );
  if (provider === undefined) throw new Error(`no shipped provider ${name}`);
  return provider;
}

describe('itestResolve', () => {
  it('reads every name as the public fixture address, localhost as loopback', async () => {
    for (const name of ['www.youtube.com', 'openrouter.ai', 'itest.example']) {
      expect(await itestResolve(name)).toEqual([
        { address: ITEST_FIXTURE_ADDRESS, family: 4 },
      ]);
    }
    expect(await itestResolve('LocalHost.')).toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
    // Public to the private-range checks the video pre-resolution applies.
    expect(isPrivateIp(ITEST_FIXTURE_ADDRESS)).toBe(false);
  });
});

describe('vendorAnswer', () => {
  it("serves OpenRouter's four listings, one model each", () => {
    for (const filter of ['', 'embeddings', 'image', 'transcription']) {
      const query = new URLSearchParams(
        filter === '' ? '' : `output_modalities=${filter}`,
      );
      const answer = vendorAnswer(
        'GET',
        'openrouter.ai',
        '/api/v1/models',
        query,
      );
      expect(answer?.status).toBe(200);
      expect(answer?.body).toEqual({ data: [expect.any(Object)] });
    }
    expect(
      vendorAnswer(
        'GET',
        'openrouter.ai',
        '/api/v1/models',
        new URLSearchParams('output_modalities=audio'),
      ),
    ).toBeNull();
  });

  it('answers the Messages API the 401 a key it does not know gets', () => {
    expect(
      vendorAnswer(
        'POST',
        'api.anthropic.com',
        '/v1/messages',
        new URLSearchParams(),
      ),
    ).toEqual({
      status: 401,
      body: {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'API key is invalid.',
        },
        request_id: null,
      },
    });
  });

  it('models nothing else', () => {
    const none = new URLSearchParams();
    expect(
      vendorAnswer('POST', 'openrouter.ai', '/api/v1/chat/completions', none),
    ).toBeNull();
    expect(
      vendorAnswer('GET', 'api.anthropic.com', '/v1/models', none),
    ).toBeNull();
    expect(
      vendorAnswer('POST', 'ai-gateway.vercel.sh', '/v1/models', none),
    ).toBeNull();
    expect(vendorAnswer('GET', 'example.org', '/v1/models', none)).toBeNull();
  });

  // A shipped provider whose catalog is listed live is one more vendor the
  // run would reach: give the stub its listing, then name it here.
  it('stands in for every shipped catalog listed live', () => {
    const live = loadProviderDefinitions().filter(
      (provider) =>
        provider.catalog.source === 'openrouter-api' ||
        provider.catalog.source === 'models-endpoint',
    );
    expect(live.map((provider) => provider.name).sort()).toEqual([
      'openrouter',
      'vercel-ai-gateway',
    ]);
    for (const provider of live) {
      const host =
        provider.catalog.source === 'openrouter-api'
          ? 'openrouter.ai'
          : new URL(provider.baseUrl ?? '').hostname;
      expect(ITEST_VENDOR_HOSTS).toContain(host);
    }
  });
});

describe('the vendor stub behind the routed fetch', () => {
  const realFetch = globalThis.fetch;
  const refused: string[] = [];
  let stub: ItestVendorStub;

  beforeEach(async () => {
    stub = await startItestVendorStub(() => undefined);
    refused.length = 0;
    globalThis.fetch = routeVendorFetch(realFetch, {
      stubOrigin: stub.origin,
      onOffBox: (request) => {
        refused.push(`${request.method} ${request.origin}`);
      },
    });
    invalidateCatalogFetchCache();
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    invalidateCatalogFetchCache();
    await stub.close();
  });

  it('serves the shipped live catalogs at their own URLs', async () => {
    const openrouter = await getProviderCatalog(shippedProvider('openrouter'), {
      maxAttempts: 1,
    });
    const gateway = await getProviderCatalog(
      shippedProvider('vercel-ai-gateway'),
      { maxAttempts: 1 },
    );
    const tagsOf = (id: string): readonly string[] | undefined =>
      openrouter.find((entry) => entry.id === id)?.tags;
    expect(tagsOf('itest-vendor/chat')).toContain('chat');
    expect(tagsOf('itest-vendor/embed')).toContain('embedding');
    expect(tagsOf('itest-vendor/image')).toContain('image-generation');
    expect(tagsOf('itest-vendor/transcribe')).toEqual(['transcription']);
    expect(
      gateway.find((entry) => entry.id === 'itest-vendor/gateway-chat')?.tags,
    ).toContain('chat');
    expect(
      stub.requests.map((request) => `${request.host}${request.path}`).sort(),
    ).toEqual([
      'ai-gateway.vercel.sh/v1/models',
      'openrouter.ai/api/v1/models',
      'openrouter.ai/api/v1/models?output_modalities=embeddings',
      'openrouter.ai/api/v1/models?output_modalities=image',
      'openrouter.ai/api/v1/models?output_modalities=transcription',
    ]);
    expect(stub.requests.every((request) => !request.credentialed)).toBe(true);
    expect(stub.unexpected).toEqual([]);
    expect(refused).toEqual([]);
  });

  it('answers a safeFetch Messages call as the vendor answers a fake key', async () => {
    const response = await safeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-itest-value',
      },
      body: JSON.stringify({ model: 'itest', max_tokens: 8, messages: [] }),
    });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { type: 'authentication_error' },
    });
    expect(stub.requests).toEqual([
      {
        method: 'POST',
        host: 'api.anthropic.com',
        path: '/v1/messages',
        credentialed: true,
      },
    ]);
  });

  it('sends a vendor Request on without the dispatcher pinned for the vendor host', async () => {
    // An unusable dispatcher: forwarded, it would fail the request.
    const init: RequestInit & { dispatcher: object } = { dispatcher: {} };
    const response = await fetch(
      new Request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': 'sk-ant-itest-value' },
        body: '{}',
      }),
      init,
    );
    expect(response.status).toBe(401);
    expect(stub.requests.map((request) => request.method)).toEqual(['POST']);
  });

  it('passes loopback through and refuses every other host as no egress does', async () => {
    const local = createServer((_req, res) => res.end('on the box'));
    await new Promise<void>((resolve) => {
      local.listen(0, '127.0.0.1', resolve);
    });
    const address = local.address();
    const port =
      address !== null && typeof address === 'object' ? address.port : 0;
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/any`);
      expect(await answer.text()).toBe('on the box');
    } finally {
      local.close();
    }
    // Coded as a connection nothing answered, like a network without egress.
    await expect(
      fetch('https://graph.microsoft.com/v1.0/me/drive?token=secret'),
    ).rejects.toMatchObject({
      message: 'fetch failed',
      cause: { code: 'ECONNREFUSED' },
    });
    // Plaintext to a vendor host is no vendor call the stub answers either.
    await expect(fetch('http://openrouter.ai/api/v1/models')).rejects.toThrow(
      'fetch failed',
    );
    // Named by host alone: a path or a query can carry a secret.
    expect(refused).toEqual([
      'GET https://graph.microsoft.com',
      'GET http://openrouter.ai',
    ]);
    expect(stub.requests).toEqual([]);
  });
});

describe('routeVendorFetch without the network', () => {
  it("passes the run's own services and in-process URLs on, and refuses as fetch does: a rejected promise", async () => {
    const passed: string[] = [];
    const recording = async (
      input: Parameters<typeof globalThis.fetch>[0],
    ): Promise<Response> => {
      passed.push(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return new Response('passed');
    };
    const refused: string[] = [];
    const routed = routeVendorFetch(
      Object.assign(recording, { preconnect: globalThis.fetch.preconnect }),
      {
        stubOrigin: 'http://127.0.0.1:1',
        onTheBox: ['http://object-store.itest:9000'],
        onOffBox: (request) => {
          refused.push(request.origin);
        },
      },
    );
    await routed('http://object-store.itest:9000/bucket/key');
    await routed('data:text/plain,on%20the%20box');
    await routed('http://LocalHost.:8080/health');
    expect(passed).toEqual([
      'http://object-store.itest:9000/bucket/key',
      'data:text/plain,on%20the%20box',
      'http://LocalHost.:8080/health',
    ]);
    const relative = routed('/no-origin');
    expect(relative).toBeInstanceOf(Promise);
    await expect(relative).rejects.toThrow();
    await expect(routed('http://object-store.itest:9001/key')).rejects.toThrow(
      'fetch failed',
    );
    expect(refused).toEqual(['http://object-store.itest:9001']);
  });
});

/**
 * Redirects, on native `fetch`'s own redirect engine: an undici MockAgent is
 * the global dispatcher with the network disabled, so every origin below is
 * an interceptor and no socket, DNS query or vendor request exists. The
 * foreign interceptor stands for any host off the box: it must never be
 * reached through a permitted origin's redirect.
 */
describe('routeVendorFetch keeps redirected hops inside the boundary', () => {
  const LOOPBACK = 'http://127.0.0.1:49112';
  const STORE = 'http://object-store.itest:9000';
  const FOREIGN = 'https://unmodeled.invalid';
  const STUB = 'http://127.0.0.1:49199';
  let previous: ReturnType<typeof getGlobalDispatcher>;
  let agent: MockAgent;
  let refused: OffBoxRequest[];
  let foreignHits: string[];
  let routed: typeof globalThis.fetch;

  /** A mocked request's body as text, whether it came as a string or bytes. */
  const textOf = (body: unknown): string =>
    body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body);
  const redirectTo = (status: number, location: string) => ({
    statusCode: status,
    data: '',
    responseOptions: { headers: { location } },
  });

  beforeEach(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    refused = [];
    foreignHits = [];
    agent
      .get(FOREIGN)
      .intercept({ path: () => true, method: () => true })
      .reply((opts) => {
        foreignHits.push(`${opts.method} ${opts.path}`);
        return { statusCode: 200, data: 'escaped' };
      })
      .persist();
    routed = routeVendorFetch(globalThis.fetch, {
      stubOrigin: STUB,
      onTheBox: [STORE],
      onOffBox: (request) => {
        refused.push(request);
      },
    });
  });

  afterEach(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });

  it('refuses a loopback redirect to an unknown origin, naming only its method and origin', async () => {
    agent
      .get(LOOPBACK)
      .intercept({ path: '/redirect' })
      .reply(() => redirectTo(302, `${FOREIGN}/escaped?token=secret`));
    await expect(routed(`${LOOPBACK}/redirect`)).rejects.toMatchObject({
      message: 'fetch failed',
      cause: { code: 'ECONNREFUSED' },
    });
    expect(foreignHits).toEqual([]);
    expect(refused).toEqual([{ method: 'GET', origin: FOREIGN }]);
  });

  it("refuses the object store's redirect to an unknown origin", async () => {
    agent
      .get(STORE)
      .intercept({ path: '/bucket/key', method: 'PUT' })
      .reply(() => redirectTo(307, `${FOREIGN}/escaped`));
    await expect(
      routed(`${STORE}/bucket/key`, { method: 'PUT', body: 'blob bytes' }),
    ).rejects.toMatchObject({
      message: 'fetch failed',
      cause: { code: 'ECONNREFUSED' },
    });
    expect(foreignHits).toEqual([]);
    expect(refused).toEqual([{ method: 'PUT', origin: FOREIGN }]);
  });

  it('follows a permitted redirect as fetch would: same origin, then on to the object store', async () => {
    const seen: string[] = [];
    agent
      .get(LOOPBACK)
      .intercept({ path: '/hop', method: 'POST' })
      .reply((opts) => {
        seen.push(`${opts.method} /hop ${textOf(opts.body)}`);
        return redirectTo(307, '/kept');
      });
    agent
      .get(LOOPBACK)
      .intercept({ path: '/kept', method: 'POST' })
      .reply((opts) => {
        seen.push(`${opts.method} /kept ${textOf(opts.body)}`);
        return redirectTo(303, `${STORE}/landed`);
      });
    agent
      .get(STORE)
      .intercept({ path: '/landed' })
      .reply((opts) => {
        const headers = new Headers(
          Object.entries(opts.headers ?? {}).map(
            ([name, value]): [string, string] => [name, String(value)],
          ),
        );
        const body =
          opts.body === undefined || opts.body === null
            ? 'none'
            : textOf(opts.body);
        seen.push(
          `${opts.method} /landed body=${body} type=${headers.get('content-type') ?? 'none'} auth=${headers.get('authorization') ?? 'none'}`,
        );
        return { statusCode: 200, data: 'landed' };
      });
    const response = await routed(`${LOOPBACK}/hop`, {
      method: 'POST',
      body: 'payload',
      headers: {
        'content-type': 'text/plain',
        authorization: 'Bearer itest-key',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('landed');
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(`${STORE}/landed`);
    // 307 keeps the method and body; 303 turns it into a bodiless GET; the
    // cross-origin hop drops the credential header.
    expect(seen).toEqual([
      'POST /hop payload',
      'POST /kept payload',
      'GET /landed body=none type=none auth=none',
    ]);
    expect(refused).toEqual([]);
    expect(foreignHits).toEqual([]);
  });

  it("re-sends a Request's own body on a 307, as fetch does for the object store's signed requests", async () => {
    const bodies: string[] = [];
    agent
      .get(STORE)
      .intercept({ path: '/bucket/key', method: 'PUT' })
      .reply((opts) => {
        bodies.push(textOf(opts.body));
        return redirectTo(307, '/bucket/moved');
      });
    agent
      .get(STORE)
      .intercept({ path: '/bucket/moved', method: 'PUT' })
      .reply((opts) => {
        bodies.push(textOf(opts.body));
        return { statusCode: 200, data: 'stored' };
      });
    const response = await routed(
      new Request(`${STORE}/bucket/key`, { method: 'PUT', body: 'blob bytes' }),
    );
    expect(await response.text()).toBe('stored');
    expect(response.url).toBe(`${STORE}/bucket/moved`);
    expect(bodies).toEqual(['blob bytes', 'blob bytes']);
    expect(refused).toEqual([]);
  });

  it('sends a redirect onto a vendor host to the vendor stub, like a first request', async () => {
    agent
      .get(LOOPBACK)
      .intercept({ path: '/to-vendor' })
      .reply(() => redirectTo(302, 'https://openrouter.ai/api/v1/models'));
    agent
      .get(STUB)
      .intercept({ path: '/openrouter.ai/api/v1/models' })
      .reply(200, '{"data":[]}');
    const response = await routed(`${LOOPBACK}/to-vendor`);
    expect(await response.text()).toBe('{"data":[]}');
    expect(response.url).toBe('https://openrouter.ai/api/v1/models');
    expect(refused).toEqual([]);
  });

  it("keeps the caller's manual and error modes: nothing is followed", async () => {
    agent
      .get(LOOPBACK)
      .intercept({ path: '/redirect' })
      .reply(() => redirectTo(302, `${FOREIGN}/escaped`))
      .times(3);
    const manual = await routed(`${LOOPBACK}/redirect`, { redirect: 'manual' });
    expect(manual.status).toBe(302);
    expect(manual.headers.get('location')).toBe(`${FOREIGN}/escaped`);
    const manualRequest = await routed(
      new Request(`${LOOPBACK}/redirect`, { redirect: 'manual' }),
    );
    expect(manualRequest.status).toBe(302);
    await expect(
      routed(`${LOOPBACK}/redirect`, { redirect: 'error' }),
    ).rejects.toThrow('fetch failed');
    expect(refused).toEqual([]);
    expect(foreignHits).toEqual([]);
  });

  it('stops where fetch stops: 20 redirects, a streamed body, a missing Location', async () => {
    let loops = 0;
    agent
      .get(LOOPBACK)
      .intercept({ path: '/loop' })
      .reply(() => {
        loops += 1;
        return redirectTo(302, '/loop');
      })
      .persist();
    await expect(routed(`${LOOPBACK}/loop`)).rejects.toMatchObject({
      message: 'fetch failed',
      cause: { message: 'redirect count exceeded' },
    });
    expect(loops).toBe(21);
    agent
      .get(LOOPBACK)
      .intercept({ path: '/stream', method: 'POST' })
      .reply(() => redirectTo(307, '/again'));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('once'));
        controller.close();
      },
    });
    const streamed: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: stream,
      duplex: 'half',
    };
    await expect(routed(`${LOOPBACK}/stream`, streamed)).rejects.toThrow(
      'fetch failed',
    );
    agent
      .get(LOOPBACK)
      .intercept({ path: '/no-location' })
      .reply(302, 'no location');
    const bare = await routed(`${LOOPBACK}/no-location`);
    expect(bare.status).toBe(302);
    expect(bare.redirected).toBe(false);
    expect(refused).toEqual([]);
    expect(foreignHits).toEqual([]);
  });
});
