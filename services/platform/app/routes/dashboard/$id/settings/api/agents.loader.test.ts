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

import { agentConnectionsQuery } from '@/app/features/settings/agent-connections/hooks/queries';

// The list must not gate page paint. An offline read pauses rather than
// rejects, so catching a preload error cannot release an awaited loader. The
// client is real; only the backend transport is stubbed.
const { list } = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: list,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: () => null,
}));
vi.mock(
  '@/app/features/settings/agent-connections/components/agent-connections-section',
  () => ({ AgentConnectionsSection: () => null }),
);

type Loader = (args: {
  context: { queryClient: QueryClient };
  params: { id: string };
}) => unknown;

const EMPTY = { connections: [], canSeeEveryone: false };

let loader: Loader;
let queryClient: QueryClient;
const queryKey = agentConnectionsQuery('org-1', {
  scope: 'mine',
  ended: false,
}).queryKey;
const preload = () =>
  loader({ context: { queryClient }, params: { id: 'org-1' } });

describe('API Connected agents route loader [AGCONN-R24]', () => {
  beforeAll(async () => {
    const { Route } = await import('./agents');
    loader = (Route as unknown as { loader: Loader }).loader;
  }, 60_000);

  beforeEach(() => {
    list.mockReset();
    list.mockResolvedValue(EMPTY);
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

  it('returns before a deferred list settles and warms the entry the table reads', async () => {
    let settle = () => {};
    list.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve(EMPTY);
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
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(EMPTY),
    );
  });

  it('asks for the person’s own live agents, the view the page opens on', () => {
    preload();
    expect(list.mock.calls[0]?.[0]).toBe(
      '/agent-connections?scope=mine&ended=false',
    );
    expect(list.mock.calls[0]?.[1]).toMatchObject({ orgId: 'org-1' });
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
    list.mockRejectedValue(new Error('offline'));

    expect(preload()).toBeUndefined();
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe('error'),
    );
    expect(queryClient.getQueryState(queryKey)?.error?.message).toBe('offline');
  });
});
