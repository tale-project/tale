import { createServer } from 'node:http';

import { isPrivateIp } from '@tale/shared/net/private-ip';
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
