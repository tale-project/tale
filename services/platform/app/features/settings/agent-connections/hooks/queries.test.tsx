import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agentConnectionAccessQuery,
  agentConnectionsQuery,
  useAgentConnectionAccess,
  useAgentConnections,
} from './queries';

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

/** The connected agents as one view of them, kept under the hint that
 * refreshes them. */
describe('agentConnectionsQuery [AGCONN-R24]', () => {
  it('keys each view under the organization’s agent connection hint, so any change refreshes it', () => {
    expect(
      agentConnectionsQuery('org-1', { scope: 'mine', ended: false }).queryKey,
    ).toEqual(['backend', 'org-1', 'agent_connection', 'list', 'mine', false]);
    expect(
      agentConnectionsQuery('org-1', { scope: 'everyone', ended: true })
        .queryKey,
    ).toEqual([
      'backend',
      'org-1',
      'agent_connection',
      'list',
      'everyone',
      true,
    ]);
  });

  it('asks the server for the view it keys, in the organization', async () => {
    backendFetch.mockResolvedValue({ connections: [], canSeeEveryone: true });
    const { result } = renderHook(
      () => useAgentConnections('org-1', { scope: 'everyone', ended: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [route, options] = backendFetch.mock.calls[0] ?? [];
    expect(route).toBe('/agent-connections?scope=everyone&ended=true');
    expect(options).toMatchObject({ orgId: 'org-1' });
    expect(result.current.data).toEqual({
      connections: [],
      canSeeEveryone: true,
    });
  });

  it('asks for the live ones of the person’s own by default', async () => {
    backendFetch.mockResolvedValue({ connections: [], canSeeEveryone: false });
    renderHook(
      () => useAgentConnections('org-1', { scope: 'mine', ended: false }),
      { wrapper },
    );
    await waitFor(() => expect(backendFetch).toHaveBeenCalled());
    expect(backendFetch.mock.calls[0]?.[0]).toBe(
      '/agent-connections?scope=mine&ended=false',
    );
  });

  it('keeps one entry for each view, so switching back is not a new read', async () => {
    backendFetch.mockResolvedValue({ connections: [], canSeeEveryone: true });
    const { result, rerender } = renderHook(
      ({ scope }: { scope: 'mine' | 'everyone' }) =>
        useAgentConnections('org-1', { scope, ended: false }),
      { wrapper, initialProps: { scope: 'mine' as 'mine' | 'everyone' } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ scope: 'everyone' });
    await waitFor(() => expect(backendFetch).toHaveBeenCalledTimes(2));
    rerender({ scope: 'mine' });
    // The first view is still there: no third read is needed to show it.
    expect(result.current.data).toBeDefined();
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });
});

describe('agentConnectionAccessQuery [AGCONN-R23]', () => {
  it('keys what a person has to do with agents under the same hint', () => {
    expect(agentConnectionAccessQuery('org-1').queryKey).toEqual([
      'backend',
      'org-1',
      'agent_connection',
      'access',
    ]);
  });

  it('reads it from the organization’s access route', async () => {
    backendFetch.mockResolvedValue({
      mayConnect: true,
      holdsConnection: false,
      signInOn: true,
    });
    const { result } = renderHook(() => useAgentConnectionAccess('org-1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(backendFetch.mock.calls[0]?.[0]).toBe('/agent-connections/access');
    expect(backendFetch.mock.calls[0]?.[1]).toMatchObject({ orgId: 'org-1' });
    expect(result.current.data).toEqual({
      mayConnect: true,
      holdsConnection: false,
      signInOn: true,
    });
  });
});
