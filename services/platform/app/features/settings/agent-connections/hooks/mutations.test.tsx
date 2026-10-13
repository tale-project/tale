import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';

import { useDisconnectAgent } from './mutations';
import { agentConnectionAccessQuery, agentConnectionsQuery } from './queries';

const { backendFetch } = vi.hoisted(() => ({ backendFetch: vi.fn() }));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch,
}));

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

/** Disconnecting an agent, and what it leaves stale. */
describe('useDisconnectAgent [AGCONN-R24]', () => {
  it('deletes the connection in the organization, naming it in the path safely', async () => {
    backendFetch.mockResolvedValue({ ok: true, id: 'conn/1' });
    const { result } = renderHook(() => useDisconnectAgent('org-1'), {
      wrapper,
    });
    await result.current.mutateAsync({ id: 'conn/1' });
    expect(backendFetch).toHaveBeenCalledWith('/agent-connections/conn%2F1', {
      orgId: 'org-1',
      method: 'DELETE',
    });
  });

  it('refreshes every view of the organization’s connections and what the person has to do with them, and no other organization’s', async () => {
    backendFetch.mockResolvedValue({ ok: true, id: 'conn-1' });
    const list = { connections: [], canSeeEveryone: false };
    const mine = agentConnectionsQuery('org-1', {
      scope: 'mine',
      ended: false,
    }).queryKey;
    const everyone = agentConnectionsQuery('org-1', {
      scope: 'everyone',
      ended: true,
    }).queryKey;
    const access = agentConnectionAccessQuery('org-1').queryKey;
    const elsewhere = agentConnectionsQuery('org-2', {
      scope: 'mine',
      ended: false,
    }).queryKey;
    client.setQueryData(mine, list);
    client.setQueryData(everyone, list);
    client.setQueryData(access, {
      mayConnect: true,
      holdsConnection: true,
      signInOn: true,
    });
    client.setQueryData(elsewhere, list);
    const { result } = renderHook(() => useDisconnectAgent('org-1'), {
      wrapper,
    });
    await result.current.mutateAsync({ id: 'conn-1' });
    for (const key of [mine, everyone, access]) {
      expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
    }
    expect(client.getQueryState(elsewhere)?.isInvalidated).toBe(false);
  });

  it('refreshes nothing when the server refuses, and hands the refusal on', async () => {
    const refusal = new BackendApiError(
      404,
      'Agent connection not found.',
      'AGENT_CONNECTION_NOT_FOUND',
    );
    backendFetch.mockRejectedValue(refusal);
    const key = agentConnectionsQuery('org-1', {
      scope: 'mine',
      ended: false,
    }).queryKey;
    client.setQueryData(key, { connections: [], canSeeEveryone: false });
    const { result } = renderHook(() => useDisconnectAgent('org-1'), {
      wrapper,
    });
    await expect(result.current.mutateAsync({ id: 'conn-1' })).rejects.toBe(
      refusal,
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});
