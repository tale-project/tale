import type { AutomationSettings } from '@tale/shared/schemas/automation-settings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import type { CurrentUserView } from '@/app/lib/backend/account';
import { currentUserQuery } from '@/app/lib/backend/account';
import { ACTION_QUERY_ADAPTERS } from '@/app/lib/backend/adapters';
import type { BackendName, QueryName } from '@/app/lib/backend/contract';

// The adapter registries are swapped for one controllable row each, as in
// `use-backend-query.test.ts`, but react-query stays real: these cases count
// the observers mounted reads leave on the two queries every read shares.
// react-query removes an observer in time linear in its query's observer
// count, so one per mounted read made a 2,000-card board's unmount
// quadratic (#4062).
const { readRow, actionRow } = vi.hoisted(() => ({
  readRow: vi.fn(),
  actionRow: vi.fn(),
}));
vi.mock('@/app/lib/backend/adapters', () => ({
  READ_ADAPTERS: { 'fake:adapted': readRow },
  ACTION_QUERY_ADAPTERS: {
    'fake:action': actionRow,
    // The settings-values hook keys its lane off this row's presence.
    'documents/public_actions:readProjectTextValues': actionRow,
  },
  WRITE_ADAPTERS: {},
  activeOrganizationId: () => undefined,
  projectAdaptedRead: vi.fn(),
  runAdapted: (run: () => Promise<unknown>) => run(),
  retryAdaptedRead: () => false,
}));
// Nothing here may reach Better Auth: its session answer is seeded below.
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: () => new Promise(() => {}) },
}));

import { useAutomationSettingsValues } from '@/app/features/automations/hooks/use-settings-values';

import { useActionQuery } from './use-action-query';
import { useBackendQuery } from './use-backend-query';
import { useSessionProbeSignedIn } from './use-session-probe';
import { useSessionUser } from './use-session-user';

const ADAPTED_READ = 'fake:adapted' as QueryName;
const ADAPTED_ACTION = 'fake:action' as BackendName;
/** A name with no row in the stub registries — the gated refusal path. */
const NO_ROW_READ = 'items:list' as QueryName;
const NO_ROW_ACTION = 'items:walk' as BackendName;

const READ_KEY = ['backend', 'org-1', 'fake', 'list'];
const ACTION_KEY = ['fake-action', 'org-1'];
const USER: CurrentUserView = { userId: 'user-1' };
const SETTINGS: AutomationSettings = {
  forms: [
    {
      file: 'settings.yml',
      title: 'Settings',
      fields: [{ key: 'name', label: 'Name', type: 'text' }],
    },
  ],
};

readRow.mockReturnValue({
  queryKey: READ_KEY,
  queryFn: () => Promise.resolve([]),
});
actionRow.mockReturnValue(() => Promise.resolve([]));

/** Both shared answers are cached and fresh, so no mount here fetches them. */
function newClient(user: CurrentUserView | null = USER): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(currentUserQuery().queryKey, user);
  client.setQueryData(sessionQueryOptions.queryKey, {
    data: null,
    error: null,
  });
  return client;
}

function observers(client: QueryClient, queryKey: readonly unknown[]) {
  return (
    client
      .getQueryCache()
      .find({ queryKey, exact: true })
      ?.getObserversCount() ?? 0
  );
}

/** Counts cache listeners from here on: a gate that listened per adapted read
 *  would call every one of them on each of the board's cache events. */
function spyCacheListeners(client: QueryClient) {
  return vi.spyOn(client.getQueryCache(), 'subscribe');
}

function sharedObservers(client: QueryClient) {
  return {
    probe: observers(client, currentUserQuery().queryKey),
    session: observers(client, sessionQueryOptions.queryKey),
  };
}

function AdaptedRead() {
  useBackendQuery(ADAPTED_READ, { organizationId: 'org-1' });
  return null;
}

function AdaptedAction() {
  useActionQuery(ACTION_KEY, ADAPTED_ACTION, {});
  return null;
}

function Board({ client, cards }: { client: QueryClient; cards: number }) {
  return (
    <QueryClientProvider client={client}>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index}>
          <AdaptedRead />
          <AdaptedAction />
        </div>
      ))}
    </QueryClientProvider>
  );
}

/** What a gated read shows: its fetch state and the error it settled on. */
function GatedRead(props: { requireAuth?: boolean; skip?: boolean }) {
  const read = useBackendQuery(
    NO_ROW_READ,
    props.skip === true ? 'skip' : { organizationId: 'org-1' },
    props.requireAuth === false ? { requireAuth: false } : undefined,
  );
  return (
    <output>
      {read.fetchStatus} · {read.error?.message ?? 'no error'}
    </output>
  );
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('session probe observers (#4062)', () => {
  it('adapted reads leave no observer on the probe or the Better Auth session, however many mount', () => {
    const client = newClient();
    const listens = spyCacheListeners(client);
    const prefetches = vi.spyOn(client, 'prefetchQuery');
    const view = render(<Board client={client} cards={1} />);
    const oneCard = sharedObservers(client);
    const cards = 2_000;

    view.rerender(<Board client={client} cards={cards} />);

    // Every read mounted and subscribed to its own query…
    expect(observers(client, READ_KEY)).toBe(cards);
    expect(observers(client, ACTION_KEY)).toBe(cards);
    // …and none of them to the two queries all of them share.
    expect(sharedObservers(client)).toEqual(oneCard);
    expect(oneCard).toEqual({ probe: 0, session: 0 });
    expect(listens).not.toHaveBeenCalled();
    expect(prefetches).not.toHaveBeenCalled();

    view.unmount();
    expect(observers(client, READ_KEY)).toBe(0);
  });

  it('a read with no adapter row still waits for the probe, then refuses by name once it answers a user', async () => {
    const client = newClient(null);
    const listens = spyCacheListeners(client);
    render(<GatedRead />, { wrapper: wrapperFor(client) });

    expect(screen.getByRole('status')).toHaveTextContent('idle · no error');
    // The gate listens to the probe without joining its observers.
    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
    expect(listens).toHaveBeenCalledTimes(1);

    act(() => {
      client.setQueryData(currentUserQuery().queryKey, USER);
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '"items:list" has no 0.5 backend row',
      );
    });
  });

  it('a gated read asks for a probe nothing has fetched yet', () => {
    // No seeded answer: the gate itself asks for the probe, as a mounting
    // observer would, instead of waiting on whoever else might.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const prefetches = vi
      .spyOn(client, 'prefetchQuery')
      .mockResolvedValue(undefined);
    render(<GatedRead />, { wrapper: wrapperFor(client) });

    expect(prefetches).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: currentUserQuery().queryKey }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('idle · no error');
  });

  it('requireAuth:false and a skipped read take no probe subscription', async () => {
    // Separate clients: both reads use the name's one `convex-retired` key, so
    // a shared cache would show the skipped read the other one's refusal.
    const open = newClient(null);
    const openListens = spyCacheListeners(open);
    render(<GatedRead requireAuth={false} />, { wrapper: wrapperFor(open) });

    expect(sharedObservers(open)).toEqual({ probe: 0, session: 0 });
    expect(openListens).not.toHaveBeenCalled();
    // requireAuth:false still runs while signed out, so it refuses at once.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '"items:list" has no 0.5 backend row',
      );
    });

    const skippedClient = newClient(null);
    const skippedListens = spyCacheListeners(skippedClient);
    const skipped = renderHook(() => useBackendQuery(NO_ROW_READ, 'skip'), {
      wrapper: wrapperFor(skippedClient),
    });
    expect(skipped.result.current.fetchStatus).toBe('idle');
    expect(sharedObservers(skippedClient)).toEqual({ probe: 0, session: 0 });
    expect(skippedListens).not.toHaveBeenCalled();
  });

  it('an action read with no row gates on the probe; an adapted one does not subscribe', async () => {
    const client = newClient(null);
    const gated = renderHook(
      () => useActionQuery(['items-walk'], NO_ROW_ACTION, {}),
      { wrapper: wrapperFor(client) },
    );

    expect(gated.result.current.fetchStatus).toBe('idle');
    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });

    act(() => {
      client.setQueryData(currentUserQuery().queryKey, USER);
    });
    // The walk retries a plain error, so its first refusal shows as the
    // failure reason before any final error.
    await waitFor(() => {
      expect(gated.result.current.failureReason?.message).toContain(
        '"items:walk" has no 0.5 backend row',
      );
    });

    gated.unmount();
    const listens = spyCacheListeners(client);
    renderHook(() => useActionQuery(ACTION_KEY, ADAPTED_ACTION, {}), {
      wrapper: wrapperFor(client),
    });
    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
    expect(listens).not.toHaveBeenCalled();
  });

  it('the automation settings read takes no probe subscription on its adapted lane', () => {
    const client = newClient(null);
    const listens = spyCacheListeners(client);
    renderHook(
      () => useAutomationSettingsValues('org-1', 'project-1', null, null),
      { wrapper: wrapperFor(client) },
    );

    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
    expect(listens).not.toHaveBeenCalled();
  });

  it('the unadapted automation settings read waits for a user, then refuses by name', async () => {
    const name = 'documents/public_actions:readProjectTextValues';
    const adapter = ACTION_QUERY_ADAPTERS[name];
    delete ACTION_QUERY_ADAPTERS[name];
    const client = newClient(null);
    const listens = spyCacheListeners(client);
    try {
      const held = renderHook(
        () =>
          useAutomationSettingsValues('org-1', 'project-1', 'Setup', SETTINGS),
        { wrapper: wrapperFor(client) },
      );

      expect(held.result.current.fetchStatus).toBe('idle');
      expect(held.result.current.error).toBeNull();
      expect(listens).toHaveBeenCalledTimes(1);
      expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });

      act(() => {
        client.setQueryData(currentUserQuery().queryKey, USER);
      });
      await waitFor(() => {
        expect(held.result.current.error?.message).toContain(
          `"${name}" has no 0.5 backend row`,
        );
      });
      held.unmount();
      expect(client.getQueryCache().hasListeners()).toBe(false);
    } finally {
      ACTION_QUERY_ADAPTERS[name] = adapter;
    }
  });

  it('useSessionUser observes the probe alone, not the Better Auth session', () => {
    const client = newClient();
    const held = renderHook(() => useSessionUser(), {
      wrapper: wrapperFor(client),
    });

    expect(held.result.current).toEqual({
      isAuthenticated: true,
      isLoading: false,
    });
    expect(sharedObservers(client)).toEqual({ probe: 1, session: 0 });
  });

  it('useSessionProbeSignedIn follows the probe only when asked, even with a cached user', async () => {
    const client = newClient();
    const wrapper = wrapperFor(client);
    let quietRenders = 0;
    const quiet = renderHook(
      () => {
        quietRenders += 1;
        return useSessionProbeSignedIn(false);
      },
      { wrapper },
    );
    const asked = renderHook(() => useSessionProbeSignedIn(true), { wrapper });
    expect(quiet.result.current).toBe(false);
    expect(asked.result.current).toBe(true);

    act(() => {
      client.setQueryData(currentUserQuery().queryKey, null);
    });
    await waitFor(() => expect(asked.result.current).toBe(false));
    act(() => {
      client.setQueryData(currentUserQuery().queryKey, USER);
    });
    await waitFor(() => expect(asked.result.current).toBe(true));

    // Not asked: it read nothing, and the probe's answers never re-rendered it.
    expect(quiet.result.current).toBe(false);
    expect(quietRenders).toBe(1);
    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
  });

  it('releases its cache listener when no longer asked and on unmount', () => {
    const client = newClient();
    const cache = client.getQueryCache();
    const held = renderHook((when: boolean) => useSessionProbeSignedIn(when), {
      initialProps: true,
      wrapper: wrapperFor(client),
    });
    expect(cache.hasListeners()).toBe(true);
    held.rerender(false);
    expect(held.result.current).toBe(false);
    expect(cache.hasListeners()).toBe(false);
    held.rerender(true);
    expect(held.result.current).toBe(true);
    expect(cache.hasListeners()).toBe(true);
    held.unmount();
    expect(cache.hasListeners()).toBe(false);
  });

  it('ignores unrelated cache events and follows the configured probe hash', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          retry: false,
          queryKeyHashFn: (key) => `custom:${JSON.stringify(key)}`,
        },
      },
    });
    client.setQueryData(currentUserQuery().queryKey, USER);
    const cache = client.getQueryCache();
    const probe = cache.build(
      client,
      client.defaultQueryOptions(currentUserQuery()),
    );
    const unrelated = cache.build(client, { queryKey: ['unrelated'] });
    renderHook(() => useSessionProbeSignedIn(true), {
      wrapper: wrapperFor(client),
    });
    const reads = vi.spyOn(client, 'getQueryData');

    await act(async () => {
      cache.notify({ type: 'observerResultsUpdated', query: unrelated });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(reads).not.toHaveBeenCalled();

    await act(async () => {
      cache.notify({ type: 'observerResultsUpdated', query: probe });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(reads).toHaveBeenCalledWith(currentUserQuery().queryKey);
  });

  it('batches probe notifications instead of reading synchronously in the cache listener', async () => {
    const client = newClient(null);
    const held = renderHook(() => useSessionProbeSignedIn(true), {
      wrapper: wrapperFor(client),
    });
    const reads = vi.spyOn(client, 'getQueryData');

    act(() => {
      client.setQueryData(currentUserQuery().queryKey, USER);
    });
    expect(reads).not.toHaveBeenCalled();
    await waitFor(() => expect(held.result.current).toBe(true));
    expect(reads).toHaveBeenCalledWith(currentUserQuery().queryKey);
  });
});
