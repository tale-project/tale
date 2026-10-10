import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useApiKeys, useCreateApiKey, useRevokeApiKey } from './use-api-keys';

/**
 * The first key moves the table's Create button from the empty state to the
 * toolbar, a remount. The create dialog restores focus to that button on
 * Done, so the mutation must not settle — and the dialog must not offer Done —
 * before the list it invalidated holds the new key; otherwise a quick Done
 * focuses the empty-state button just before the refetch unmounts it.
 */

const { apiKey, backendFetch } = vi.hoisted(() => ({
  apiKey: { create: vi.fn(), delete: vi.fn() },
  backendFetch: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({ authClient: { apiKey } }));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch,
}));

const key = {
  id: 'key-1',
  name: 'CI key',
  owner: { kind: 'user' as const },
};
const LIST_KEY = ['backend', 'org-1', 'api_key', 'settings-list'];

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** What `GET /api/app/api-keys` answers next: a list of keys, or a
 * thunk for an answer made only when asked (a pending or failing read). */
function listAnswers(...answers: (unknown[] | (() => Promise<unknown>))[]) {
  for (const answer of answers) {
    backendFetch.mockImplementationOnce((route: string) => {
      expect(route).toBe('/api-keys');
      return Array.isArray(answer)
        ? Promise.resolve({ keys: answer })
        : answer();
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  backendFetch.mockReset();
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
    let settleList: (value: unknown) => void = () => {};
    listAnswers(
      [],
      () =>
        new Promise((resolve) => {
          settleList = resolve;
        }),
    );
    const { result } = renderCreateWithList();
    await waitFor(() => expect(result.current.keys.data).toEqual([]));

    let created: unknown;
    const pending = result.current.create.mutateAsync({
      name: 'CI key',
      owner: { kind: 'self' },
    });
    void pending.then((value) => {
      created = value;
    });

    await waitFor(() => expect(backendFetch).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toBeUndefined();

    settleList({ keys: [key] });
    await expect(pending).resolves.toEqual({
      key: 'tale_secret',
      id: key.id,
    });
    expect(client.getQueryData(LIST_KEY)).toEqual([key]);
  });

  it('still hands back the key when the refetch fails', async () => {
    listAnswers([], () => Promise.reject(new Error('offline')));
    const { result } = renderCreateWithList();
    await waitFor(() => expect(result.current.keys.data).toEqual([]));

    // The secret is shown once; a failed list read must never withhold it.
    await expect(
      result.current.create.mutateAsync({
        name: 'CI key',
        owner: { kind: 'self' },
      }),
    ).resolves.toEqual({ key: 'tale_secret', id: key.id });
  });

  it('makes a key for a team at the organization door, bound to it', async () => {
    backendFetch.mockResolvedValueOnce({ id: 'key-2', key: 'tale_team' });
    const { result } = renderHook(() => useCreateApiKey('org-1'), {
      wrapper,
    });

    await expect(
      result.current.mutateAsync({
        name: 'Team sync',
        expiresIn: 7 * 86_400,
        owner: { kind: 'team', teamId: 'team-1', role: 'editor' },
      }),
    ).resolves.toEqual({ key: 'tale_team', id: 'key-2' });
    expect(apiKey.create).not.toHaveBeenCalled();
    expect(backendFetch).toHaveBeenCalledWith('/api-keys', {
      orgId: 'org-1',
      method: 'POST',
      body: {
        name: 'Team sync',
        expiresIn: 7 * 86_400,
        owner: { kind: 'team', teamId: 'team-1', role: 'editor' },
      },
    });
  });
});

describe('useRevokeApiKey', () => {
  it('ends the viewer’s own key at the api-key plugin', async () => {
    apiKey.delete.mockResolvedValue({ data: { success: true } });
    const { result } = renderHook(() => useRevokeApiKey('org-1'), {
      wrapper,
    });

    await result.current.mutateAsync({ id: 'key-1', owner: { kind: 'user' } });

    expect(apiKey.delete).toHaveBeenCalledWith({ keyId: 'key-1' });
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it('ends a key bound to the organization at its own door', async () => {
    backendFetch.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useRevokeApiKey('org-1'), {
      wrapper,
    });

    await result.current.mutateAsync({
      id: 'key/2',
      owner: { kind: 'organization' },
    });

    expect(backendFetch).toHaveBeenCalledWith('/api-keys/key%2F2', {
      orgId: 'org-1',
      method: 'DELETE',
    });
    expect(apiKey.delete).not.toHaveBeenCalled();
  });
});

/**
 * A person's own key works in every organization they belong to, so every
 * cached view of keys — this page's and the budget editor's picker, in this
 * organization and the others the cache holds — must hear of a change at
 * once, not after the stale window.
 */
describe('the cached key views', () => {
  const VIEWS = [
    ['backend', 'org-1', 'api_key', 'org-list'],
    ['backend', 'org-1', 'api_key', 'settings-list'],
    ['backend', 'org-2', 'api_key', 'settings-list'],
  ];
  const UNRELATED = ['backend', 'org-1', 'team', 'list'];

  function seedViews() {
    for (const view of [...VIEWS, UNRELATED]) {
      client.setQueryData(view, []);
    }
  }

  it('are invalidated when a key is created', async () => {
    backendFetch.mockResolvedValue({ keys: [] });
    const { result } = renderHook(() => useCreateApiKey('org-1'), {
      wrapper,
    });
    seedViews();

    await result.current.mutateAsync({
      name: 'CI key',
      owner: { kind: 'self' },
    });

    for (const view of VIEWS) {
      expect(client.getQueryState(view)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(UNRELATED)?.isInvalidated).toBe(false);
  });

  it('are invalidated when a key is revoked', async () => {
    apiKey.delete.mockResolvedValue({ data: { success: true } });
    const { result } = renderHook(() => useRevokeApiKey('org-1'), {
      wrapper,
    });
    seedViews();

    await result.current.mutateAsync({ id: 'key-1', owner: { kind: 'user' } });

    await waitFor(() => {
      for (const view of VIEWS) {
        expect(client.getQueryState(view)?.isInvalidated).toBe(true);
      }
    });
    expect(client.getQueryState(UNRELATED)?.isInvalidated).toBe(false);
  });
});

describe('account-wide key changes across organizations', () => {
  it.each(['create', 'revoke'] as const)(
    '%s refreshes active panels and inactive lists without unrelated refetches',
    async (mutation) => {
      client.setDefaultOptions({
        queries: { retry: false, staleTime: 5 * 60 * 1000 },
      });
      let keys = mutation === 'create' ? [] : [key];
      backendFetch.mockImplementation(async (route: string) => {
        expect(route).toBe('/api-keys');
        return { keys };
      });
      apiKey.create.mockImplementation(async () => {
        keys = [key];
        return { data: { key: 'synthetic-secret', id: key.id } };
      });
      apiKey.delete.mockImplementation(async () => {
        keys = [];
        return { data: { success: true } };
      });
      const orgA = renderHook(() => useApiKeys('org-a'), { wrapper });
      await waitFor(() => expect(orgA.result.current.data).toEqual(keys));
      orgA.unmount();
      const orgB = renderHook(
        () => ({
          keys: useApiKeys('org-b'),
          create: useCreateApiKey('org-b'),
          revoke: useRevokeApiKey('org-b'),
        }),
        { wrapper },
      );
      const panel = renderHook(() => useApiKeys('org-c'), { wrapper });
      await waitFor(() => expect(orgB.result.current.keys.data).toEqual(keys));
      await waitFor(() => expect(panel.result.current.data).toEqual(keys));
      const derivedKeys = ['org-a', 'org-b'].flatMap((org) => [
        ['backend', org, 'api_key', 'org-list'],
        ['backend', org, 'api_key', 'my-access'],
      ]);
      for (const queryKey of derivedKeys) client.setQueryData(queryKey, []);
      const unrelated = ['backend', 'org-b', 'document', 'list'];
      client.setQueryData(unrelated, ['unchanged']);

      await act(async () => {
        if (mutation === 'create') {
          await orgB.result.current.create.mutateAsync({
            name: key.name,
            owner: { kind: 'self' },
          });
        } else {
          await orgB.result.current.revoke.mutateAsync(key);
        }
      });

      await waitFor(() => expect(panel.result.current.data).toEqual(keys));
      expect(orgB.result.current.keys.data).toEqual(keys);
      expect(
        client.getQueryState(['backend', 'org-a', 'api_key', 'settings-list'])
          ?.isInvalidated,
      ).toBe(true);
      // Only mounted lists refetch; the inactive A list waits for return.
      expect(backendFetch).toHaveBeenCalledTimes(5);
      for (const queryKey of derivedKeys) {
        expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
      }
      expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);

      const returnedA = renderHook(() => useApiKeys('org-a'), { wrapper });
      await waitFor(() => expect(returnedA.result.current.data).toEqual(keys));
      expect(backendFetch).toHaveBeenCalledTimes(6);
    },
  );
});
