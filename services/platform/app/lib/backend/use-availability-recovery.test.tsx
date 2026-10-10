// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAvailabilityRecovery } from './use-availability-recovery';

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
});
