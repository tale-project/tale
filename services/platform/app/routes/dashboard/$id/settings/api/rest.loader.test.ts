import { QueryClient, onlineManager } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { apiKeysQuery } from '@/app/features/settings/api-keys/hooks/use-api-keys';

// Lists must not gate page paint. An offline read pauses rather than rejects,
// so catching a preload error cannot release an awaited loader. The client is
// real; only the auth transport and cached ability are stubbed.
const { cachedAbility, list } = vi.hoisted(() => ({
  cachedAbility: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({ authClient: { apiKey: { list } } }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: () => null,
}));
vi.mock('@/app/lib/loader-preload', () => ({ cachedAbility }));
vi.mock('@/app/features/settings/api-keys/components/api-keys-table', () => ({
  ApiKeysTable: () => null,
}));

type Loader = (args: {
  context: { queryClient: QueryClient };
  params: { id: string };
}) => unknown;

let loader: Loader;
let queryClient: QueryClient;
const queryKey = apiKeysQuery('org-1').queryKey;
const preload = () =>
  loader({ context: { queryClient }, params: { id: 'org-1' } });

describe('API REST route loader', () => {
  beforeAll(async () => {
    const { Route } = await import('./rest');
    loader = (Route as unknown as { loader: Loader }).loader;
  }, 60_000);

  beforeEach(() => {
    cachedAbility.mockReset();
    cachedAbility.mockReturnValue(null);
    list.mockReset();
    list.mockResolvedValue({ data: { apiKeys: [] } });
    onlineManager.setOnline(true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.mount();
  });

  afterEach(() => {
    queryClient.clear();
    queryClient.unmount();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  it('returns before a deferred list settles and warms the hook cache', async () => {
    let settle = () => {};
    list.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve({ data: { apiKeys: [] } });
      }),
    );

    try {
      expect(preload()).toBeUndefined();
      expect(list).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching');
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    } finally {
      settle();
    }
    await waitFor(() => expect(queryClient.getQueryData(queryKey)).toEqual([]));
  });

  it('returns while a cold offline read is paused, without calling transport', () => {
    onlineManager.setOnline(false);
    const result = preload();

    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('paused');
    expect(list).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('leaves a failed read to the page instead of failing the transition', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    list.mockResolvedValue({ error: { message: 'offline' } });

    expect(preload()).toBeUndefined();
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe('error'),
    );
    expect(queryClient.getQueryState(queryKey)?.error?.message).toBe('offline');
  });

  it('reads nothing for a caller the cached ability already denies', () => {
    cachedAbility.mockReturnValue({ cannot: () => true });

    expect(preload()).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKey)).toBeUndefined();
  });
});
