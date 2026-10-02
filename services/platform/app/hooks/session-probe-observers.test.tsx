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
import { useSessionUser } from './use-session-user';

const ADAPTED_READ = 'fake:adapted' as QueryName;
const ADAPTED_ACTION = 'fake:action' as BackendName;
/** A name with no row in the stub registries — the gated refusal path. */
const NO_ROW_READ = 'items:list' as QueryName;
const NO_ROW_ACTION = 'items:walk' as BackendName;

const READ_KEY = ['backend', 'org-1', 'fake', 'list'];
const ACTION_KEY = ['fake-action', 'org-1'];
const USER: CurrentUserView = { userId: 'user-1' };

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
    const view = render(<Board client={client} cards={1} />);
    const oneCard = sharedObservers(client);

    view.rerender(<Board client={client} cards={60} />);

    // Every read mounted and subscribed to its own query…
    expect(observers(client, READ_KEY)).toBe(60);
    expect(observers(client, ACTION_KEY)).toBe(60);
    // …and none of them to the two queries all of them share.
    expect(sharedObservers(client)).toEqual(oneCard);
    expect(oneCard).toEqual({ probe: 0, session: 0 });

    view.unmount();
    expect(observers(client, READ_KEY)).toBe(0);
  });

  it('a read with no adapter row still waits for the probe, then refuses by name once it answers a user', async () => {
    const client = newClient(null);
    render(<GatedRead />, { wrapper: wrapperFor(client) });

    expect(screen.getByRole('status')).toHaveTextContent('idle · no error');
    // The gate is a live subscription: the one read that reads the probe.
    expect(sharedObservers(client)).toEqual({ probe: 1, session: 0 });

    act(() => {
      client.setQueryData(currentUserQuery().queryKey, USER);
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '"items:list" has no 0.5 backend row',
      );
    });
  });

  it('requireAuth:false and a skipped read take no probe subscription', async () => {
    // Separate clients: both reads use the name's one `convex-retired` key, so
    // a shared cache would show the skipped read the other one's refusal.
    const open = newClient(null);
    render(<GatedRead requireAuth={false} />, { wrapper: wrapperFor(open) });

    expect(sharedObservers(open)).toEqual({ probe: 0, session: 0 });
    // requireAuth:false still runs while signed out, so it refuses at once.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '"items:list" has no 0.5 backend row',
      );
    });

    const skippedClient = newClient(null);
    const skipped = renderHook(() => useBackendQuery(NO_ROW_READ, 'skip'), {
      wrapper: wrapperFor(skippedClient),
    });
    expect(skipped.result.current.fetchStatus).toBe('idle');
    expect(sharedObservers(skippedClient)).toEqual({ probe: 0, session: 0 });
  });

  it('an action read with no row gates on the probe; an adapted one does not subscribe', () => {
    const client = newClient(null);
    const gated = renderHook(
      () => useActionQuery(['items-walk'], NO_ROW_ACTION, {}),
      { wrapper: wrapperFor(client) },
    );

    expect(gated.result.current.fetchStatus).toBe('idle');
    expect(sharedObservers(client)).toEqual({ probe: 1, session: 0 });

    gated.unmount();
    renderHook(() => useActionQuery(ACTION_KEY, ADAPTED_ACTION, {}), {
      wrapper: wrapperFor(client),
    });
    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
  });

  it('the automation settings read takes no probe subscription on its adapted lane', () => {
    const client = newClient(null);
    renderHook(
      () => useAutomationSettingsValues('org-1', 'project-1', null, null),
      { wrapper: wrapperFor(client) },
    );

    expect(sharedObservers(client)).toEqual({ probe: 0, session: 0 });
  });

  it('useSessionUser holds the probe alone, and reads it unsubscribed when asked', () => {
    const client = newClient();
    const wrapper = wrapperFor(client);

    const held = renderHook(() => useSessionUser(), { wrapper });
    expect(held.result.current).toEqual({
      isAuthenticated: true,
      isLoading: false,
    });
    expect(sharedObservers(client)).toEqual({ probe: 1, session: 0 });

    const quiet = renderHook(() => useSessionUser({ subscribed: false }), {
      wrapper,
    });
    expect(quiet.result.current.isAuthenticated).toBe(true);
    expect(sharedObservers(client)).toEqual({ probe: 1, session: 0 });
  });
});
