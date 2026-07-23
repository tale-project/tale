import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { providerConnectorSchema } from '../../../lib/shared/schemas/providers';
import { safeFetch, SafeFetchError } from '../http/safe_fetch';
import {
  CATALOG_TTL_MS,
  getConnectorCatalog,
  invalidateCatalogFetchCache,
} from './catalog_fetch';

vi.mock('../http/safe_fetch', async (importOriginal) => {
  const original = await importOriginal<typeof import('../http/safe_fetch')>();
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

const OPENROUTER = providerConnectorSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'openrouter-api' },
  auth: [{ method: 'api-key' }],
});

const VERCEL = providerConnectorSchema.parse({
  name: 'vercel-ai-gateway',
  displayName: 'Vercel AI Gateway',
  apiFormat: 'openai',
  // Trailing slash on purpose: the /models join must not double it.
  baseUrl: 'https://ai-gateway.vercel.sh/v1/',
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }],
});

const STATIC_ANTHROPIC = providerConnectorSchema.parse({
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

describe('getConnectorCatalog — live sources', () => {
  it('fetches OpenRouter once, serves the cache within the daily window, and appends the shipped defaults', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    const first = await getConnectorCatalog(OPENROUTER);
    // Fetched entries lead; the shipped models/openrouter.yml defaults
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );

    const second = await getConnectorCatalog(OPENROUTER);
    expect(second).toEqual(first);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after the daily window elapses', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    await getConnectorCatalog(OPENROUTER);
    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    await getConnectorCatalog(OPENROUTER);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses a fresh cache', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    await getConnectorCatalog(OPENROUTER);
    await getConnectorCatalog(OPENROUTER, { forceRefresh: true });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('joins the models endpoint onto the connector base URL', async () => {
    mockedFetch.mockResolvedValue(listingResponse(USABLE_PAYLOAD));
    const entries = await getConnectorCatalog(VERCEL);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://ai-gateway.vercel.sh/v1/models',
      expect.anything(),
    );
    expect(entries.every((e) => e.provider === 'vercel-ai-gateway')).toBe(true);
  });

  it('serves the previous catalog when a refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(listingResponse(USABLE_PAYLOAD));
    const first = await getConnectorCatalog(OPENROUTER, { maxAttempts: 1 });

    vi.setSystemTime(Date.now() + CATALOG_TTL_MS + 1);
    mockedFetch.mockRejectedValueOnce(
      new SafeFetchError('network_error', 'connect refused'),
    );
    const second = await getConnectorCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('serving the previous catalog'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('serves the shipped defaults on a cold failure when the connector has them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    const entries = await getConnectorCatalog(OPENROUTER, { maxAttempts: 1 });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.id)).toContain('anthropic/claude-fable-5');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('serving the shipped defaults'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('propagates a cold failure when the connector ships no defaults', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockRejectedValue(new SafeFetchError('timeout', 'timed out'));
    await expect(
      getConnectorCatalog(VERCEL, { maxAttempts: 1 }),
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
      getConnectorCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('HTTP 503');
  });

  it('treats a listing with no usable models as a failure and caches nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(
      listingResponse({ data: [{ id: 'missing-context-window' }] }),
    );
    await expect(
      getConnectorCatalog(VERCEL, { maxAttempts: 1 }),
    ).rejects.toThrow('no usable models');

    mockedFetch.mockResolvedValueOnce(listingResponse(USABLE_PAYLOAD));
    const entries = await getConnectorCatalog(VERCEL, { maxAttempts: 1 });
    expect(entries).toHaveLength(2);
  });

  it('returns empty for a catalog-less connector without touching the network', async () => {
    const connector = providerConnectorSchema.parse({
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
    await expect(getConnectorCatalog(connector)).resolves.toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('getConnectorCatalog — static source', () => {
  it('serves the shipped static catalog without touching the network', async () => {
    const entries = await getConnectorCatalog(STATIC_ANTHROPIC);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.provider === 'anthropic')).toBe(true);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('warns and returns empty for a static connector with no catalog file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const connector = providerConnectorSchema.parse({
      ...STATIC_ANTHROPIC,
      name: 'no-such-provider',
    });
    await expect(getConnectorCatalog(connector)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no-such-provider'),
    );
    warn.mockRestore();
  });
});
