import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import { providerDefinitionSchema } from '../../../../lib/shared/schemas/providers';
import {
  CATALOG_TTL_MS,
  getProviderCatalog,
  invalidateCatalogFetchCache,
} from './catalog_fetch';

vi.mock('../../../../lib/net/safe-fetch', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../../lib/net/safe-fetch')>();
  return { ...original, safeFetch: vi.fn() };
});

const mockedFetch = vi.mocked(safeFetch);

function listingResponse(payload: unknown) {
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: JSON.stringify(payload),
    finalUrl: 'https://example.test/models',
  };
}

const USABLE_PAYLOAD = {
  data: [
    { id: 'anthropic/claude-sonnet-5', context_length: 200_000 },
    { id: 'openai/gpt-5.5', context_length: 400_000 },
  ],
};

// OpenRouter serves embedding models ONLY behind this filtered listing —
// the default listing excludes them entirely. Note the PLURAL modality.
const EMBEDDINGS_PAYLOAD = {
  data: [
    {
      id: 'qwen/qwen3-embedding-8b',
      context_length: 32_768,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['embeddings'],
      },
    },
  ],
};

/** Route the mock per URL: default listing vs the embeddings supplement. */
function mockOpenRouterListings() {
  mockedFetch.mockImplementation(async (url: string) =>
    url.includes('output_modalities=embeddings')
      ? listingResponse(EMBEDDINGS_PAYLOAD)
      : listingResponse(USABLE_PAYLOAD),
  );
}

const OPENROUTER = providerDefinitionSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'openrouter-api' },
  auth: [{ method: 'api-key' }],
});

const VERCEL = providerDefinitionSchema.parse({
  name: 'vercel-ai-gateway',
  displayName: 'Vercel AI Gateway',
  apiFormat: 'openai',
  // Trailing slash on purpose: the /models join must not double it.
  baseUrl: 'https://ai-gateway.vercel.sh/v1/',
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }],
});

const STATIC_ANTHROPIC = providerDefinitionSchema.parse({
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  catalog: { source: 'static' },
  auth: [{ method: 'api-key' }],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));
});

afterEach(() => {
  invalidateCatalogFetchCache();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('getProviderCatalog — live sources', () => {
  it('fetches both OpenRouter listings once, serves the cache within the daily window, and appends the shipped defaults', async () => {
    mockOpenRouterListings();
    const first = await getProviderCatalog(OPENROUTER);
    // Fetched entries lead; the shipped models/openrouter/models.yml defaults
    // follow for every id the listing didn't carry. The fetched
    // claude-sonnet-5 wins over the default of the same id (exactly one).
    expect(first.slice(0, 2).map((e) => e.id)).toEqual([
      'anthropic/claude-sonnet-5',
      'openai/gpt-5.5',
    ]);
    expect(first.length).toBeGreaterThan(2);
    expect(
      first.filter((e) => e.id === 'anthropic/claude-sonnet-5'),
    ).toHaveLength(1);
    expect(first.map((e) => e.id)).toContain('anthropic/claude-fable-5');
    expect(first.every((e) => e.provider === 'openrouter')).toBe(true);
    // One request per listing: the default population and the embeddings
    // supplement OpenRouter hides behind its modality filter.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?output_modalities=embeddings',
      expect.objectContaining({ method: 'GET' }),
    );

    const second = await getProviderCatalog(OPENROUTER);
    expect(second).toEqual(first);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('merges the embeddings listing in, tagged and carrying the curated width', async () => {
    mockOpenRouterListings();
    const entries = await getProviderCatalog(OPENROUTER);
    const embedding = entries.find((e) => e.id === 'qwen/qwen3-embedding-8b');
    expect(embedding).toBeDefined();
    expect(embedding?.tags).toContain('embedding');
    expect(embedding?.tags).not.toContain('chat');
    // The LIVE entry wins by id but publishes no vector width — the shipped
    // default's curated `embedding` block must survive the shadowing, or a
    // catalog refresh would erase the facts the one-click setup reads.
    expect(embedding?.embedding).toEqual({
      dimensions: 1536,
      recommended: true,
    });
  });

  it('carries the curated reasoning.off over a live entry of the same id and knob', async () => {
    mockedFetch.mockImplementation(async (url: string) =>
      url.includes('output_modalities=embeddings')
        ? listingResponse({ data: [] })
        : listingResponse({
            data: [
              {
                id: 'z-ai/glm-5.2',
                context_length: 202_752,
                supported_parameters: ['tools', 'reasoning'],
              },
              // The listing stopped reporting this one as reasoning-capable.
              { id: 'x-ai/grok-4.5', context_length: 2_000_000 },
            ],
          }),
    );
    const entries = await getProviderCatalog(OPENROUTER);
    // Same id, same effort knob: the probe-verified off survives the
    // refresh — a live listing never publishes how to switch thinking off.
    const glm = entries.find((e) => e.id === 'z-ai/glm-5.2');
    expect(glm?.reasoning).toEqual({ knob: 'effort', off: 'none' });
    // No reasoning on the live entry → no off zombie may ride along.
    const grok = entries.find((e) => e.id === 'x-ai/grok-4.5');
    expect(grok?.reasoning).toBeUndefined();
  });

  it('keeps the primary catalog when the embeddings supplement fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.includes('output_modalities=embeddings')) {
        throw new SafeFetchError('network_error', 'connect refused');
      }
      return listingResponse(USABLE_PAYLOAD);
    });
    const entries = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(entries.map((e) => e.id)).toContain('anthropic/claude-sonnet-5');
    // The LIVE embeddings supplement never landed (the shipped defaults may
    // still contribute their own curated embedding entries — that overlay is
    // exactly what keeps an air-gapped install working).
    expect(entries.map((e) => e.id)).not.toContain('qwen/qwen3-embedding-4b');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('supplementary listing'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('refetches after the daily window elapses', async () => {
    mockOpenRouterListings();
    await getProviderCatalog(OPENROUTER);
    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    await getProviderCatalog(OPENROUTER);
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it('forceRefresh bypasses a fresh cache', async () => {
    mockOpenRouterListings();
    await getProviderCatalog(OPENROUTER);
    await getProviderCatalog(OPENROUTER, { forceRefresh: true });
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it('joins the models endpoint onto the provider base URL', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    const entries = await getProviderCatalog(VERCEL);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/models',
      expect.anything(),
    );
    expect(entries.every((e) => e.provider === 'vercel-ai-gateway')).toBe(true);
  });

  it('does not share a cache entry between same-named providers on different base URLs', async () => {
    // Two organizations may both call their gateway "vercel-ai-gateway" while
    // pointing it at different hosts; the second org must get its own listing,
    // not the first org's cached one.
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    await getProviderCatalog(VERCEL);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    const otherOrg = providerDefinitionSchema.parse({
      ...VERCEL,
      baseUrl: 'https://gateway.other-org.internal/v1',
    });
    await getProviderCatalog(otherOrg);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenLastCalledWith(
      'https://gateway.other-org.internal/v1/models',
      expect.anything(),
    );

    // Same name + same baseUrl stays one entry: the daily window still holds.
    await getProviderCatalog(VERCEL);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('serves the previous catalog when a refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRouterListings();
    const first = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });

    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    mockedFetch.mockRejectedValue(
      new SafeFetchError('network_error', 'connect refused'),
    );
    const second = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('serving the previous catalog'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('serves the shipped defaults on a cold failure when the provider has them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    const entries = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.id)).toContain('anthropic/claude-fable-5');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('serving the shipped defaults'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('propagates a cold failure when the provider ships no defaults', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('timed out');
  });

  it('rejects a non-2xx listing response (no defaults to fall back on)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValue({
      ...listingResponse({}),
      status: 503,
      statusText: 'Service Unavailable',
    });
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('HTTP 503');
  });

  it('treats a listing with no usable models as a failure and caches nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(
      listingResponse({ data: [{ id: 'missing-context-window' }] }),
    );
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('no usable models');

    mockedFetch.mockResolvedValueOnce(listingResponse(USABLE_PAYLOAD));
    const entries = await getProviderCatalog(VERCEL, { maxAttempts: 1 });
    expect(entries).toHaveLength(2);
  });

  it('returns empty for a catalog-less provider without touching the network', async () => {
    const provider = providerDefinitionSchema.parse({
      name: 'nous-portal',
      displayName: 'Nous Portal',
      apiFormat: 'openai',
      baseUrl: 'https://portal.nousresearch.com',
      catalog: { source: 'none' },
      auth: [
        {
          method: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'hermes' },
        },
      ],
    });
    await expect(getProviderCatalog(provider)).resolves.toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('getProviderCatalog — static source', () => {
  it('serves the shipped static catalog without touching the network', async () => {
    const entries = await getProviderCatalog(STATIC_ANTHROPIC);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.provider === 'anthropic')).toBe(true);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('warns and returns empty for a static provider with no catalog file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = providerDefinitionSchema.parse({
      ...STATIC_ANTHROPIC,
      name: 'no-such-provider',
    });
    await expect(getProviderCatalog(provider)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no-such-provider'),
    );
    warn.mockRestore();
  });
});
