import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useApiKeys, useCreateApiKey } from './use-api-keys';

/**
 * The first key moves the table's Create button from the empty state to the
 * toolbar, a remount. The create dialog restores focus to that button on
 * Done, so the mutation must not settle — and the dialog must not offer Done —
 * before the list it invalidated holds the new key; otherwise a quick Done
 * focuses the empty-state button just before the refetch unmounts it.
 */

const { apiKey } = vi.hoisted(() => ({
  apiKey: { create: vi.fn(), list: vi.fn() },
}));

vi.mock('@/lib/auth-client', () => ({ authClient: { apiKey } }));

const key = { id: 'key-1', name: 'CI key' };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  apiKey.create.mockResolvedValue({
    data: { key: 'tale_secret', id: key.id },
  });
});

function renderCreateWithList() {
  return renderHook(
    () => ({
      keys: useApiKeys('org-1'),
      create: useCreateApiKey('org-1'),
    }),
    { wrapper },
  );
}

describe('useCreateApiKey', () => {
  it('settles only once the refetched list holds the new key', async () => {
    apiKey.list.mockResolvedValueOnce({ data: { apiKeys: [] } });
    const { result } = renderCreateWithList();
    await waitFor(() => expect(result.current.keys.data).toEqual([]));

    let settleList: (value: unknown) => void = () => {};
    apiKey.list.mockReturnValueOnce(
      new Promise((resolve) => {
        settleList = resolve;
      }),
    );

    let created: unknown;
    const pending = result.current.create.mutateAsync({ name: 'CI key' });
    void pending.then((value) => {
      created = value;
    });

    await waitFor(() => expect(apiKey.list).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toBeUndefined();

    settleList({ data: { apiKeys: [key] } });
    await expect(pending).resolves.toEqual({
      key: 'tale_secret',
      id: key.id,
    });
    expect(client.getQueryData(['api-keys', 'org-1'])).toEqual([key]);
  });

  it('still hands back the key when the refetch fails', async () => {
    apiKey.list.mockResolvedValueOnce({ data: { apiKeys: [] } });
    const { result } = renderCreateWithList();
    await waitFor(() => expect(result.current.keys.data).toEqual([]));

    apiKey.list.mockResolvedValueOnce({ error: { message: 'offline' } });

    // The secret is shown once; a failed list read must never withhold it.
    await expect(
      result.current.create.mutateAsync({ name: 'CI key' }),
    ).resolves.toEqual({ key: 'tale_secret', id: key.id });
  });
});
