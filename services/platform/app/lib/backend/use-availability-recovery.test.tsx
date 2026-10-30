// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasPendingAvailabilityRecovery,
  useAvailabilityRecovery,
} from './use-availability-recovery';

const connection = vi.hoisted(() => ({ reachable: true }));
vi.mock('./connection-state', () => ({
  useBackendReachable: () => connection.reachable,
}));

afterEach(() => {
  cleanup();
  connection.reachable = true;
});

describe('availability recovery', () => {
  it('refreshes an exhausted backend read on recovery without retrying a write', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let ready = false;
    const read = vi.fn(async () => {
      if (!ready) throw new TypeError('Failed to fetch');
      return ['recovered'];
    });
    const write = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: write, retry: false });
    await expect(mutation.execute(undefined)).rejects.toThrow(
      'Failed to fetch',
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      () => {
        useAvailabilityRecovery();
        return useQuery({
          queryKey: ['backend', 'synthetic-read'],
          queryFn: read,
        });
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => {
      connection.reachable = false;
      rerender();
    });
    expect(read).toHaveBeenCalledTimes(1);
    ready = true;
    act(() => {
      connection.reachable = true;
      rerender();
    });
    await waitFor(() => expect(result.current.data).toEqual(['recovered']));
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    act(() => {
      rerender();
    });
    expect(read).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('stays pending from the outage until its refresh is issued', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const seen: boolean[] = [];
    // Its effect runs in the commit that ends the outage, before the
    // recovery's own: the refresh is still owed at that point.
    function Reader({ reachable }: { reachable: boolean }) {
      useEffect(() => {
        if (reachable) seen.push(hasPendingAvailabilityRecovery(client));
      }, [reachable]);
      return null;
    }
    function Recovery() {
      useAvailabilityRecovery();
      return null;
    }
    const tree = () => (
      <QueryClientProvider client={client}>
        <Reader reachable={connection.reachable} />
        <Recovery />
      </QueryClientProvider>
    );
    connection.reachable = false;
    const { rerender } = render(tree());
    expect(hasPendingAvailabilityRecovery(client)).toBe(true);

    connection.reachable = true;
    rerender(tree());
    expect(seen).toEqual([true]);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['backend'],
    });
    expect(hasPendingAvailabilityRecovery(client)).toBe(false);
  });

  it('owes nothing once it unmounts', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    connection.reachable = false;
    const { unmount } = renderHook(() => useAvailabilityRecovery(), {
      wrapper,
    });
    expect(hasPendingAvailabilityRecovery(client)).toBe(true);
    unmount();
    expect(hasPendingAvailabilityRecovery(client)).toBe(false);
  });
});
