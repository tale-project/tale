import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendQuery } from './use-backend-query';

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

function mountUsage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useBackendQuery('sandbox/session_queries_public:getSandboxQuotaUsage', {
        organizationId: 'org-a',
      }),
    { wrapper },
  );
  return { ...hook, client };
}

describe('sandbox allocation reads through the real backend query', () => {
  it('surfaces failures, waits during retry, and recovers after repeated failure', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () => Response.json({}, { status: 503 }));
    const { result, unmount, client } = mountUsage();
    try {
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        '/api/app/sandbox/quota-usage?orgId=org-a',
      );
      let finishRetry!: (response: Response) => void;
      fetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishRetry = resolve;
          }),
      );
      let retry!: ReturnType<typeof result.current.refetch>;
      act(() => {
        retry = result.current.refetch();
      });
      await waitFor(() => expect(result.current.isFetching).toBe(true));
      expect(result.current.data).toBeUndefined();
      await act(async () => {
        finishRetry(Response.json({}, { status: 503 }));
        await retry;
      });
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.isError).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(8);
      const usage = [
        {
          budget: 'project',
          used: 1,
          cap: 5,
          atLimit: false,
          nearLimit: false,
        },
      ];
      fetch.mockResolvedValue(Response.json({ usage }));
      await act(async () => {
        await result.current.refetch();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(usage);
      expect(result.current.error).toBeNull();
    } finally {
      unmount();
      client.clear();
    }
  });

  it.each([null, {}, { usage: null }])(
    'keeps successful absent allocations unavailable: %j',
    async (body) => {
      vi.spyOn(window, 'fetch').mockResolvedValue(Response.json(body));
      const { result, unmount, client } = mountUsage();
      try {
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
        expect(result.current.isError).toBe(false);
      } finally {
        unmount();
        client.clear();
      }
    },
  );
});
