import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import {
  CATALOG_FAILURE_BACKOFF_MS,
  CATALOG_TTL_MS,
  catalogFailureCode,
  CatalogListingError,
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

/** Actual OpenRouter STT listing shape: the token window is not applicable
 * to most entries, and the prompt price may be duration-based. */
const TRANSCRIPTION_PAYLOAD = {
  data: [
    {
      id: 'microsoft/mai-transcribe-2',
      context_length: 0,
      architecture: {
        input_modalities: ['audio'],
        output_modalities: ['transcription'],
      },
      pricing: { prompt: '0.1', completion: '0' },
    },
  ],
};
const TRANSCRIPTION_URL =
  'https://openrouter.ai/api/v1/models?output_modalities=transcription';

/** OpenRouter serves image generators that write no text only behind this
 * filtered listing (abridged live entry, 2026-09-29). */
const IMAGE_PAYLOAD = {
  data: [
    {
      id: 'black-forest-labs/flux.2-pro',
      context_length: 46_864,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['image'],
      },
      pricing: { image_output: '0.00000732421875' },
    },
  ],
};
const IMAGE_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';

/** OpenRouter's image API listing: what each image model accepts, as
 * parameter descriptors (abridged live entries, 2026-10-27). */
const IMAGE_FACTS_PAYLOAD = {
  data: [
    {
      id: 'black-forest-labs/flux.2-pro',
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1', '3:2', '2:3', 'auto'] },
        input_references: { type: 'range', min: 0, max: 8 },
        output_format: { type: 'enum', values: ['png', 'jpeg'] },
      },
    },
    // Facts for a model no catalog listing names never become an entry.
    {
      id: 'example/unlisted-image-model',
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1'] },
      },
    },
  ],
};
const IMAGE_FACTS_URL = 'https://openrouter.ai/api/v1/images/models';

/** Route the mock per URL: default listing vs the modality supplements. */
function mockOpenRouterListings() {
  mockedFetch.mockImplementation(async (url: string) =>
    url.includes('output_modalities=embeddings')
      ? listingResponse(EMBEDDINGS_PAYLOAD)
      : url === TRANSCRIPTION_URL
        ? listingResponse(TRANSCRIPTION_PAYLOAD)
        : url === IMAGE_URL
          ? listingResponse(IMAGE_PAYLOAD)
          : url === IMAGE_FACTS_URL
            ? listingResponse(IMAGE_FACTS_PAYLOAD)
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
  it('discovers zero-context OpenRouter STT models and shares the supplement cache with capability reads', async () => {
    mockOpenRouterListings();
    const all = await getProviderCatalog(OPENROUTER);
    const speech = all.find(
      (entry) => entry.id === 'microsoft/mai-transcribe-2',
    );
    expect(speech).toEqual({
      id: 'microsoft/mai-transcribe-2',
      provider: 'openrouter',
      tags: ['transcription'],
      supportsTools: false,
      supportsVision: false,
      contextWindow: 0,
    });
    expect(
      await getProviderCatalog(OPENROUTER, {
        requiredCapability: 'transcription',
      }),
    ).toEqual([speech]);
    expect(
      mockedFetch.mock.calls.filter(([url]) => url === TRANSCRIPTION_URL),
    ).toHaveLength(1);
  });

  it('reports a cold STT supplement failure to audio callers without blanking chat or caching missing capability for a day', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockImplementation(async (url) => {
      if (url === TRANSCRIPTION_URL)
        throw new SafeFetchError('timeout', 'STT catalog timed out');
      return listingResponse(USABLE_PAYLOAD);
    });
    const all = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(all.some((entry) => entry.tags.includes('chat'))).toBe(true);
    await expect(
      getProviderCatalog(OPENROUTER, {
        maxAttempts: 1,
        requiredCapability: 'transcription',
      }),
    ).rejects.toThrow('STT catalog timed out');
    expect(
      mockedFetch.mock.calls.filter(([url]) => url === TRANSCRIPTION_URL),
    ).toHaveLength(1);
    vi.setSystemTime(Date.now() + CATALOG_FAILURE_BACKOFF_MS + 1);
    mockOpenRouterListings();
    const recovered = await getProviderCatalog(OPENROUTER, {
      maxAttempts: 1,
      requiredCapability: 'transcription',
    });
    expect(recovered.map((entry) => entry.id)).toEqual([
      'microsoft/mai-transcribe-2',
    ]);
    expect(
      mockedFetch.mock.calls.filter(([url]) => url === TRANSCRIPTION_URL),
    ).toHaveLength(2);
  });

  it('resolves STT without requiring a healthy chat listing or shipped defaults', async () => {
    mockedFetch.mockImplementation(async (url) => {
      if (url !== TRANSCRIPTION_URL) throw new Error('chat listing offline');
      return listingResponse(TRANSCRIPTION_PAYLOAD);
    });
    const entries = await getProviderCatalog(
      { ...OPENROUTER, name: 'custom-router' },
      { maxAttempts: 1, requiredCapability: 'transcription' },
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'microsoft/mai-transcribe-2',
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a filtered STT response that contains only chat instead of caching a false missing-model answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    await expect(
      getProviderCatalog(OPENROUTER, {
        maxAttempts: 1,
        requiredCapability: 'transcription',
      }),
    ).rejects.toThrow('no usable models');
  });

  it('keeps last-good STT on ordinary refresh failure and surfaces a forced supplement failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRouterListings();
    const first = await getProviderCatalog(OPENROUTER, {
      maxAttempts: 1,
      requiredCapability: 'transcription',
    });
    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    mockedFetch.mockImplementation(async (url) => {
      if (url === TRANSCRIPTION_URL) throw new Error('STT catalog offline');
      return listingResponse(USABLE_PAYLOAD);
    });
    expect(
      await getProviderCatalog(OPENROUTER, {
        maxAttempts: 1,
        requiredCapability: 'transcription',
      }),
    ).toEqual(first);
    await expect(
      getProviderCatalog(OPENROUTER, { maxAttempts: 1, forceRefresh: true }),
    ).rejects.toThrow('STT catalog offline');
    expect(
      await getProviderCatalog(OPENROUTER, {
        maxAttempts: 1,
        requiredCapability: 'transcription',
      }),
    ).toEqual(first);
  });

  it('fetches all OpenRouter listings once, serves the cache within the daily window, and appends the shipped defaults', async () => {
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
    // One request per listing: the default population, the embeddings,
    // image and transcription supplements OpenRouter hides behind their
    // modality filters, and the image API's own listing of image facts.
    expect(mockedFetch).toHaveBeenCalledTimes(5);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?output_modalities=embeddings',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      TRANSCRIPTION_URL,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      IMAGE_FACTS_URL,
      expect.objectContaining({ method: 'GET' }),
    );

    const second = await getProviderCatalog(OPENROUTER);
    expect(second).toEqual(first);
    expect(mockedFetch).toHaveBeenCalledTimes(5);
  });

  it('merges the image listing in, so a generator that writes no text is offered', async () => {
    mockOpenRouterListings();
    const entries = await getProviderCatalog(OPENROUTER);
    const flux = entries.find((e) => e.id === 'black-forest-labs/flux.2-pro');
    expect(flux?.tags).toContain('image-generation');
    expect(flux?.tags).not.toContain('chat');
    expect(flux?.outputsMedia).toBe(true);
  });

  it('sets the image facts on the image entries the listings name', async () => {
    mockOpenRouterListings();
    const entries = await getProviderCatalog(OPENROUTER);
    const flux = entries.find((e) => e.id === 'black-forest-labs/flux.2-pro');
    expect(flux?.imageGeneration).toEqual({
      aspectRatios: ['1:1', '3:2', '2:3'],
      referenceImages: { min: 0, max: 8 },
      outputFormats: ['png', 'jpeg'],
    });
    expect(entries.map((e) => e.id)).not.toContain(
      'example/unlisted-image-model',
    );
    expect(
      entries.find((e) => e.id === 'anthropic/claude-sonnet-5')
        ?.imageGeneration,
    ).toBeUndefined();
  });

  it('keeps the image entries, without facts, when the facts listing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === IMAGE_FACTS_URL) {
        throw new SafeFetchError('network_error', 'connect refused');
      }
      return url === IMAGE_URL
        ? listingResponse(IMAGE_PAYLOAD)
        : listingResponse(USABLE_PAYLOAD);
    });
    const entries = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    const flux = entries.find((e) => e.id === 'black-forest-labs/flux.2-pro');
    expect(flux?.tags).toContain('image-generation');
    expect(flux?.imageGeneration).toBeUndefined();
    warn.mockRestore();
  });

  it('keeps the last facts when the facts listing fails, and asks again soon', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRouterListings();
    const fluxOf = async () =>
      (await getProviderCatalog(OPENROUTER, { maxAttempts: 1 })).find(
        (e) => e.id === 'black-forest-labs/flux.2-pro',
      );
    const facts = (await fluxOf())?.imageGeneration;
    expect(facts?.aspectRatios).toEqual(['1:1', '3:2', '2:3']);

    // The daily refresh finds the facts listing down: the facts the last
    // fetch read keep serving, rather than a day of requests the model
    // refuses.
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === IMAGE_FACTS_URL) {
        throw new SafeFetchError('network_error', 'connect refused');
      }
      return url === IMAGE_URL
        ? listingResponse(IMAGE_PAYLOAD)
        : listingResponse(USABLE_PAYLOAD);
    });
    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    expect((await fluxOf())?.imageGeneration).toEqual(facts);

    // Incomplete, the catalog is asked for again once the back-off lapses.
    const calls = mockedFetch.mock.calls.length;
    await fluxOf();
    expect(mockedFetch.mock.calls.length).toBe(calls);
    mockOpenRouterListings();
    vi.setSystemTime(Date.now() + CATALOG_FAILURE_BACKOFF_MS + 1);
    expect((await fluxOf())?.imageGeneration).toEqual(facts);
    expect(mockedFetch.mock.calls.length).toBeGreaterThan(calls);
    warn.mockRestore();
  });

  it('reads a facts listing it cannot parse as a failure, not as no facts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockImplementation(async (url: string) =>
      url === IMAGE_FACTS_URL
        ? // A shape the reader no longer knows: descriptors as plain names.
          listingResponse({
            data: [
              {
                id: 'black-forest-labs/flux.2-pro',
                supported_parameters: ['aspect_ratio', 'input_references'],
              },
            ],
          })
        : url === IMAGE_URL
          ? listingResponse(IMAGE_PAYLOAD)
          : listingResponse(USABLE_PAYLOAD),
    );
    await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('held no facts it could read'),
    );
    warn.mockRestore();
  });

  it('asks for every supplement at once, so a slow one holds up none', async () => {
    const pending = new Map<string, () => void>();
    mockedFetch.mockImplementation(async (url: string) => {
      const answer = url.includes('output_modalities=embeddings')
        ? listingResponse(EMBEDDINGS_PAYLOAD)
        : url === TRANSCRIPTION_URL
          ? listingResponse(TRANSCRIPTION_PAYLOAD)
          : url === IMAGE_URL
            ? listingResponse(IMAGE_PAYLOAD)
            : url === IMAGE_FACTS_URL
              ? listingResponse(IMAGE_FACTS_PAYLOAD)
              : listingResponse(USABLE_PAYLOAD);
      if (
        url === 'https://openrouter.ai/api/v1/models' ||
        url === TRANSCRIPTION_URL
      ) {
        return answer;
      }
      return await new Promise((resolve) => {
        pending.set(url, () => resolve(answer));
      });
    });
    const catalog = getProviderCatalog(OPENROUTER);
    await vi.advanceTimersByTimeAsync(0);
    // All three supplements are in flight before any of them answered.
    expect([...pending.keys()].sort()).toEqual(
      [
        'https://openrouter.ai/api/v1/models?output_modalities=embeddings',
        IMAGE_URL,
        IMAGE_FACTS_URL,
      ].sort(),
    );
    for (const answer of pending.values()) answer();
    const entries = await catalog;
    expect(entries.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        'anthropic/claude-sonnet-5',
        'qwen/qwen3-embedding-8b',
        'black-forest-labs/flux.2-pro',
      ]),
    );
    expect(
      entries.find((e) => e.id === 'black-forest-labs/flux.2-pro')
        ?.imageGeneration,
    ).toBeDefined();
  });

  it('keeps the primary catalog when the image supplement fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === IMAGE_URL) {
        throw new SafeFetchError('network_error', 'connect refused');
      }
      return listingResponse(USABLE_PAYLOAD);
    });
    const entries = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(entries.map((e) => e.id)).toContain('anthropic/claude-sonnet-5');
    expect(entries.map((e) => e.id)).not.toContain(
      'black-forest-labs/flux.2-pro',
    );
    warn.mockRestore();
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
    expect(mockedFetch).toHaveBeenCalledTimes(10);
  });

  it('forceRefresh bypasses a fresh cache', async () => {
    mockOpenRouterListings();
    await getProviderCatalog(OPENROUTER);
    await getProviderCatalog(OPENROUTER, { forceRefresh: true });
    expect(mockedFetch).toHaveBeenCalledTimes(10);
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

  it('remembers a failed fetch and rethrows it without refetching until the back-off lapses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('timed out');
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Inside the back-off: the remembered failure answers, no retry ladder.
    vi.setSystemTime(Date.now() + CATALOG_FAILURE_BACKOFF_MS - 1);
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('timed out');
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Past it: the source is asked again.
    vi.setSystemTime(Date.now() + 2);
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    const entries = await getProviderCatalog(VERCEL, { maxAttempts: 1 });
    expect(entries).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('logs a remembered failure once, not on every read the back-off answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRouterListings();
    await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });

    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    mockedFetch.mockRejectedValue(
      new SafeFetchError('network_error', 'connect refused'),
    );
    await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    warn.mockClear();

    // Every read inside the back-off serves the previous catalog silently:
    // the failure was logged when it was remembered.
    vi.setSystemTime(Date.now() + 1);
    await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('serves the shipped defaults from a remembered failure without refetching', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    const first = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(first.length).toBeGreaterThan(0);
    const calls = mockedFetch.mock.calls.length;

    const second = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(second).toEqual(first);
    expect(mockedFetch).toHaveBeenCalledTimes(calls);
  });

  it('forceRefresh bypasses the failure back-off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('timed out');
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1, forceRefresh: true }),
    ).rejects.toThrow('timed out');
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent fetches of one catalog into a single request', async () => {
    let release: (value: ReturnType<typeof listingResponse>) => void = () => {};
    mockedFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = getProviderCatalog(VERCEL, { maxAttempts: 1 });
    const second = getProviderCatalog(VERCEL, { maxAttempts: 1 });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    release(listingResponse(USABLE_PAYLOAD));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a forced refresh failure instead of the stale catalog, which keeps serving other callers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRouterListings();
    const first = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });

    mockedFetch.mockRejectedValue(
      new SafeFetchError('network_error', 'connect refused'),
    );
    await expect(
      getProviderCatalog(OPENROUTER, { maxAttempts: 1, forceRefresh: true }),
    ).rejects.toThrow('connect refused');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('forced refresh failed'),
      expect.anything(),
    );

    // A plain read still gets the previous catalog.
    const after = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(after).toEqual(first);
    warn.mockRestore();
  });

  it('names a listing that answers with a server error, asks again, and never quotes the answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValue({
      ...listingResponse({ error: 'worker 10.0.0.7 crashed' }),
      status: 503,
      statusText: 'Service Unavailable',
    });
    const pending = getProviderCatalog(VERCEL, { maxAttempts: 3 }).catch(
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const failure = await pending;
    expect(failure).toBeInstanceOf(CatalogListingError);
    expect(catalogFailureCode(failure)).toBe('PROVIDER_CATALOG_UPSTREAM_ERROR');
    // The status alone: no listing URL, nothing the endpoint answered.
    expect((failure as Error).message).toBe('catalog fetch returned HTTP 503');
    // The endpoint's own failure may pass, so the ladder runs to its end.
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])(
    'names a listing whose key the endpoint refuses (HTTP %i), asking once and keeping the code while the refusal is remembered',
    async (status) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedFetch.mockResolvedValue({
        ...listingResponse({ error: 'Invalid key sk-listing-1234' }),
        status,
        statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
      });
      const failure: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 3,
        bearerToken: 'sk-listing-1234',
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CatalogListingError);
      expect(catalogFailureCode(failure)).toBe('PROVIDER_CATALOG_KEY_REFUSED');
      expect((failure as Error).message).toBe(
        `catalog fetch returned HTTP ${status}`,
      );
      // The same key gets the same answer: no second attempt.
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      // A read inside the back-off answers from memory with the same code.
      const remembered: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 3,
        bearerToken: 'sk-listing-1234',
      }).catch((error: unknown) => error);
      expect(catalogFailureCode(remembered)).toBe(
        'PROVIDER_CATALOG_KEY_REFUSED',
      );
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['dns_failed', 'Host does not resolve: ai-gateway.vercel.sh'],
    [
      'network_error',
      'Connection failed: connect ECONNREFUSED 10.0.0.7:443 (ECONNREFUSED)',
    ],
    [
      'tls_error',
      'TLS handshake failed: certificate has expired (CERT_HAS_EXPIRED)',
    ],
    ['timeout', 'Request timed out after 20000ms'],
  ] as const)(
    'names a listing that got no answer (%s), asking again and keeping the code while the failure is remembered',
    async (kind, message) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedFetch.mockRejectedValue(new SafeFetchError(kind, message));
      const pending = getProviderCatalog(VERCEL, { maxAttempts: 2 }).catch(
        (error: unknown) => error,
      );
      await vi.runAllTimersAsync();
      const failure = await pending;
      expect(catalogFailureCode(failure)).toBe('PROVIDER_CATALOG_UNREACHABLE');
      expect((failure as Error).message).toBe(message);
      expect(mockedFetch).toHaveBeenCalledTimes(2);

      const remembered: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 1,
      }).catch((error: unknown) => error);
      expect(catalogFailureCode(remembered)).toBe(
        'PROVIDER_CATALOG_UNREACHABLE',
      );
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps no code for a failure the reader can only learn from the log', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // safeFetch refusing the URL itself — a policy, a redirect, a size…
    for (const kind of [
      'private_ip',
      'host_not_allowed',
      'redirect_limit_exceeded',
      'response_too_large',
    ] as const) {
      invalidateCatalogFetchCache();
      mockedFetch.mockRejectedValue(
        new SafeFetchError(kind, `${kind} refusal`),
      );
      const failure: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 1,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SafeFetchError);
      expect(catalogFailureCode(failure)).toBeUndefined();
    }
    // …and any other status that is no model list, such as a rate limit.
    invalidateCatalogFetchCache();
    mockedFetch.mockResolvedValue({
      ...listingResponse({}),
      status: 429,
      statusText: 'Too Many Requests',
    });
    const limited: unknown = await getProviderCatalog(VERCEL, {
      maxAttempts: 1,
    }).catch((error: unknown) => error);
    expect(limited).toBeInstanceOf(Error);
    expect((limited as Error).message).toBe('catalog fetch returned HTTP 429');
    expect(catalogFailureCode(limited)).toBeUndefined();
  });

  it('names a listing that answers with a web page, asks once and never quotes the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A gateway's dashboard answers its root path, so a base URL without
      // the API's /v1 gets this page back with a 200.
      mockedFetch.mockResolvedValue({
        ...listingResponse({}),
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: '<!doctype html><html><title>Gateway dashboard</title></html>',
      });
      const failure: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 3,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CatalogListingError);
      expect(catalogFailureCode(failure)).toBe('PROVIDER_CATALOG_NOT_JSON');
      expect((failure as Error).message).toContain('text/html');
      expect((failure as Error).message).not.toContain('<!doctype');
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('names a listing URL that answers 404, asking once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue({
        ...listingResponse({ detail: 'Not Found' }),
        status: 404,
        statusText: 'Not Found',
      });
      const failure: unknown = await getProviderCatalog(VERCEL, {
        maxAttempts: 3,
      }).catch((error: unknown) => error);
      expect(catalogFailureCode(failure)).toBe('PROVIDER_CATALOG_NOT_FOUND');
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('treats a listing with no usable models as a failure and caches nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No id at all: a bare entry WITH an id would be served under the assumed
    // window a models endpoint gets, so the unusable shape here is idless.
    mockedFetch.mockResolvedValueOnce(
      listingResponse({ data: [{ object: 'model', owned_by: 'nobody' }] }),
    );
    await expect(
      getProviderCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('no usable models');

    // Nothing was cached as a catalog: once the failure back-off lapses the
    // source is asked again and a good listing serves in full.
    vi.setSystemTime(Date.now() + CATALOG_FAILURE_BACKOFF_MS + 1);
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

describe('getProviderCatalog — listing credential', () => {
  function unauthorized() {
    return {
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      body: '',
      finalUrl: 'https://ai-gateway.vercel.sh/v1/models',
    };
  }

  it('sends the bearer with the listing request, and nothing without one', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    await getProviderCatalog(VERCEL, { maxAttempts: 1, forceRefresh: true });
    expect(mockedFetch).toHaveBeenLastCalledWith(
      'https://ai-gateway.vercel.sh/v1/models',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
    await getProviderCatalog(VERCEL, {
      maxAttempts: 1,
      forceRefresh: true,
      bearerToken: 'sk-listing',
    });
    expect(mockedFetch).toHaveBeenLastCalledWith(
      'https://ai-gateway.vercel.sh/v1/models',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          authorization: 'Bearer sk-listing',
        },
      }),
    );
  });

  it('lets the first attempt that brings a key through an anonymous refusal, but honours a refusal of the key itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // An endpoint that wants a key refuses the anonymous listing…
      mockedFetch.mockResolvedValueOnce(unauthorized());
      await expect(
        getProviderCatalog(VERCEL, { maxAttempts: 1 }),
      ).rejects.toThrow('HTTP 401');
      // …and the remembered refusal keeps serving anonymous callers…
      await expect(
        getProviderCatalog(VERCEL, { maxAttempts: 1 }),
      ).rejects.toThrow('HTTP 401');
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      // …while the first caller with a key goes out and populates the cache.
      mockedFetch.mockResolvedValueOnce(listingResponse(USABLE_PAYLOAD));
      const entries = await getProviderCatalog(VERCEL, {
        maxAttempts: 1,
        bearerToken: 'sk-listing',
      });
      expect(entries.map((entry) => entry.id)).toEqual([
        'anthropic/claude-sonnet-5',
        'openai/gpt-5.5',
      ]);
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      // The populated cache now serves an anonymous read too.
      await expect(
        getProviderCatalog(VERCEL, { maxAttempts: 1 }),
      ).resolves.toHaveLength(2);
      expect(mockedFetch).toHaveBeenCalledTimes(2);

      // A refusal of the key itself is remembered like any other failure:
      // the next keyed attempt inside the back-off does not go out again.
      invalidateCatalogFetchCache();
      mockedFetch.mockResolvedValueOnce(unauthorized());
      await expect(
        getProviderCatalog(VERCEL, { maxAttempts: 1, bearerToken: 'bad' }),
      ).rejects.toThrow('HTTP 401');
      await expect(
        getProviderCatalog(VERCEL, { maxAttempts: 1, bearerToken: 'bad' }),
      ).rejects.toThrow('HTTP 401');
      expect(mockedFetch).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getProviderCatalog — bare models endpoint listing', () => {
  it('serves an OpenAI-style listing that names models and nothing else', async () => {
    mockedFetch.mockResolvedValue(
      listingResponse({
        object: 'list',
        data: [
          { id: 'qwen3-max', object: 'model', created: 1, owned_by: 'system' },
          { id: 'qwen-plus', object: 'model', created: 1, owned_by: 'system' },
        ],
      }),
    );
    const entries = await getProviderCatalog(VERCEL, { maxAttempts: 1 });
    expect(entries.map((entry) => entry.id)).toEqual([
      'qwen3-max',
      'qwen-plus',
    ]);
    expect(entries[0]).toMatchObject({
      contextWindow: 128_000,
      supportsTools: true,
      supportsVision: false,
      tags: ['chat'],
    });
  });

  it('keeps refusing bare entries from a catalog that always publishes the window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockedFetch.mockResolvedValue(
        listingResponse({ data: [{ id: 'vendor/model', object: 'model' }] }),
      );
      // OpenRouter degrades to its shipped defaults; the bare entry is not
      // among what serves.
      const entries = await getProviderCatalog(OPENROUTER, { maxAttempts: 1 });
      expect(entries.some((entry) => entry.id === 'vendor/model')).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('openrouter'),
        expect.objectContaining({
          message: expect.stringContaining('yielded no usable models'),
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('getProviderCatalog — a gateway listing that does not describe its models', () => {
  /** A custom provider in front of a gateway that lists the vendor models it
   * routes by id, window and price only (Bifrost's rows, 2026-10-28). */
  const GATEWAY = providerDefinitionSchema.parse({
    name: 'bifrost',
    displayName: 'Bifrost',
    apiFormat: 'openai',
    baseUrl: 'https://gateway.example.test/v1',
    catalog: { source: 'models-endpoint' },
    auth: [{ method: 'api-key' }],
  });
  const row = (id: string) => ({
    id,
    created: 1780876800,
    context_length: 400_000,
    max_output_tokens: 128_000,
    pricing: { prompt: '0.000002', completion: '0.00001' },
  });

  it("gives each row what Tale's shipped catalogs know about its model", async () => {
    mockedFetch.mockResolvedValue(
      listingResponse({
        data: [
          row('openai/gpt-5.6-luna'),
          row('anthropic/claude-opus-5-5'),
          row('anthropic/claude-example-9-9'),
          row('openai/text-embedding-3-small'),
        ],
      }),
    );
    const entries = await getProviderCatalog(GATEWAY, { maxAttempts: 1 });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    // Known to the shipped OpenAI catalog: it sees images and its effort can
    // be set — but the off value and tools rule of OpenAI's own wire stay
    // there.
    expect(byId.get('openai/gpt-5.6-luna')).toMatchObject({
      tags: ['chat', 'vision'],
      supportsTools: true,
      supportsVision: true,
      reasoning: { knob: 'effort' },
    });
    expect(byId.get('openai/gpt-5.6-luna')?.reasoning).toEqual({
      knob: 'effort',
    });
    // Known in the vendor's own spelling (`claude-opus-5-5`).
    expect(byId.get('anthropic/claude-opus-5-5')).toMatchObject({
      supportsVision: true,
      reasoning: { knob: 'effort' },
    });
    // Unknown: takes tools, sees no images, no effort control.
    const unknown = byId.get('anthropic/claude-example-9-9');
    expect(unknown).toMatchObject({
      tags: ['chat'],
      supportsTools: true,
      supportsVision: false,
    });
    expect(unknown).not.toHaveProperty('reasoning');
    // Known as an embedding model: never offered as a chat model.
    expect(byId.get('openai/text-embedding-3-small')?.tags).toEqual([]);
  });

  describe("with a vendor's catalog and an aggregator's defaults that disagree", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'known-models-'));
      const write = async (relative: string, lines: string[]) => {
        await mkdir(path.dirname(path.join(root, relative)), {
          recursive: true,
        });
        await writeFile(path.join(root, relative), [...lines, ''].join('\n'));
      };
      await mkdir(path.join(root, 'harnesses'), { recursive: true });
      await write('providers/acme/provider.yml', [
        'name: acme',
        'displayName: Acme',
        'apiFormat: openai',
        'baseUrl: https://api.acme.example.test/v1',
        'catalog:',
        '  source: static',
        'auth:',
        '  - method: api-key',
      ]);
      await write('models/acme/models.yml', [
        '- id: acme-1',
        '  provider: acme',
        '  tags: [chat]',
        '  supportsTools: true',
        '  supportsVision: false',
        '  contextWindow: 100000',
      ]);
      // An aggregator whose shipped defaults say otherwise about the model,
      // and sort first by name.
      await write('providers/aaa-aggregator/provider.yml', [
        'name: aaa-aggregator',
        'displayName: Aggregator',
        'apiFormat: openai',
        'baseUrl: https://aggregator.example.test/v1',
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ]);
      await write('models/aaa-aggregator/models.yml', [
        '- id: acme/acme-1',
        '  provider: aaa-aggregator',
        '  tags: [chat]',
        '  supportsTools: true',
        '  supportsVision: true',
        '  contextWindow: 100000',
      ]);
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("asks the vendor's own catalog first", async () => {
      mockedFetch.mockResolvedValue(
        listingResponse({ data: [row('gateway/acme-1')] }),
      );
      const [entry] = await getProviderCatalog(GATEWAY, {
        maxAttempts: 1,
        root,
      });
      expect(entry).toMatchObject({
        id: 'gateway/acme-1',
        supportsVision: false,
      });
    });
  });
});
