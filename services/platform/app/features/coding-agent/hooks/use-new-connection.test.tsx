// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ backendFetch: vi.fn() }));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: h.backendFetch,
}));

import { agentConnectionsQuery } from '@/app/features/settings/agent-connections/hooks/queries';
import type {
  AgentConnection,
  AgentConnectionList,
} from '@/app/features/settings/agent-connections/types';

import { useNewConnection } from './use-new-connection';

function connection(
  id: string,
  clientName: string,
  createdAt: number,
): AgentConnection {
  return {
    id,
    userId: 'ada',
    clientName,
    provenance: 'registered',
    clientHost: null,
    scopes: ['tale:mcp'],
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
    revokeReason: null,
    personName: 'Ada Lovelace',
    personEmail: 'ada@example.test',
  };
}

function answer(...connections: AgentConnection[]): AgentConnectionList {
  return { connections, canSeeEveryone: false };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

/** Whether an agent signed in while the setup was open. */
describe('useNewConnection', () => {
  it('waits while the connections are the ones that were there', async () => {
    h.backendFetch.mockResolvedValue(answer(connection('old', 'Cursor', 1)));
    const { result } = renderHook(() => useNewConnection('org-1'), { wrapper });
    await waitFor(() => expect(h.backendFetch).toHaveBeenCalled());
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(result.current).toEqual({ state: 'waiting' });
  });

  it('reports an agent that signs in after the setup opened', async () => {
    h.backendFetch.mockResolvedValueOnce(
      answer(connection('old', 'Cursor', 1)),
    );
    const { result } = renderHook(() => useNewConnection('org-1'), { wrapper });
    // The first answer is in: it is the baseline.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          agentConnectionsQuery('org-1', { scope: 'mine', ended: false })
            .queryKey,
        ),
      ).toBeDefined(),
    );
    expect(result.current).toEqual({ state: 'waiting' });

    h.backendFetch.mockResolvedValue(
      answer(connection('old', 'Cursor', 1), connection('new', 'Codex', 5)),
    );
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        state: 'connected',
        clientName: 'Codex',
      }),
    );
  });

  it('does not take a list cached from before for the baseline', async () => {
    // The page already holds a stale list that lacks an agent connected since.
    queryClient.setQueryData(
      agentConnectionsQuery('org-1', { scope: 'mine', ended: false }).queryKey,
      answer(connection('old', 'Cursor', 1)),
      { updatedAt: Date.now() - 60_000 },
    );
    h.backendFetch.mockResolvedValue(
      answer(
        connection('old', 'Cursor', 1),
        connection('between', 'Claude Code', 3),
      ),
    );
    const { result } = renderHook(() => useNewConnection('org-1'), { wrapper });
    await waitFor(() => expect(h.backendFetch).toHaveBeenCalled());
    // The fresh answer is the baseline: the agent that connected before the
    // setup opened is not the one being set up.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ state: 'waiting' });
  });

  it('keeps waiting when the read fails', async () => {
    h.backendFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useNewConnection('org-1'), { wrapper });
    await waitFor(() => expect(h.backendFetch).toHaveBeenCalled());
    expect(result.current).toEqual({ state: 'waiting' });
  });
});
