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

import { agentConnectionAccessQuery } from '@/app/features/settings/agent-connections/hooks/queries';

// What decides the Connected agents tab must not gate the API pages' paint: an
// offline read pauses rather than rejects, so catching a preload error cannot
// release an awaited loader. The client is real; only the transport is stubbed.
const { read } = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: read,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Outlet: () => null,
  useRouterState: () => '',
}));

type Loader = (args: {
  context: { queryClient: QueryClient };
  params: { id: string };
}) => unknown;

const ACCESS = { mayConnect: true, holdsConnection: false, signInOn: true };

let loader: Loader;
let queryClient: QueryClient;
const queryKey = agentConnectionAccessQuery('org-1').queryKey;
const preload = () =>
  loader({ context: { queryClient }, params: { id: 'org-1' } });

describe('API settings route loader [AGCONN-R23]', () => {
  beforeAll(async () => {
    const { Route } = await import('./route');
    loader = (Route as unknown as { loader: Loader }).loader;
  }, 60_000);

  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue(ACCESS);
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

  it('returns before the answer arrives and warms the entry the layout reads', async () => {
    let settle = () => {};
    read.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve(ACCESS);
      }),
    );

    try {
      expect(preload()).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0]?.[0]).toBe('/agent-connections/access');
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching');
    } finally {
      settle();
    }
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(ACCESS),
    );
  });

  it('returns while a cold offline read is paused, without calling transport', () => {
    onlineManager.setOnline(false);
    const result = preload();

    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('paused');
    expect(read).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('leaves a failed read to the layout instead of failing the transition', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    read.mockRejectedValue(new Error('offline'));

    expect(preload()).toBeUndefined();
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe('error'),
    );
  });
});
