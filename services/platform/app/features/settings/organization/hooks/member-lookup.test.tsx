import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from '@/app/lib/backend/api-client';
import type { MemberLookupWire } from '@/app/lib/backend/member-lookup-batch';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { MEMBER_HINT_ENTITY } from '@/lib/shared/hint-entities';
import { act, renderHook, waitFor } from '@/tests/utils/render';

import {
  type MemberLookupTarget,
  useAskedMemberLookup,
  useMemberLookup,
} from './member-lookup';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));

const fetchMock = vi.mocked(backendFetch);

function member(
  userId: string,
  displayName: string,
  createdAt: string,
): MemberLookupWire {
  return {
    id: `member-${userId}`,
    userId,
    role: 'member',
    createdAt,
    displayName,
    email: `${userId.replace('user-', '')}@acme.example`,
  };
}

const ada = member('user-ada', 'Ada Lovelace', '2026-01-02 09:00:00+00');
const noah = member('user-noah', 'Noah Berg', '2026-01-01 09:00:00+00');
const everyone = [ada, noah];

/** The user ids and handles one lookup route names. */
function namedIn(route: string): string[] {
  const query = new URLSearchParams(route.split('?')[1]);
  return [
    ...(query.get('userIds')?.split(',') ?? []),
    ...(query.get('handles')?.split(',') ?? []),
  ];
}

/** The user ids and handles each lookup request named. */
function lookupsSent(): string[][] {
  return fetchMock.mock.calls.map(([route]) => namedIn(route));
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // The app's freshness (`app/router.tsx`): a person read once stays fresh.
  client = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: Infinity, staleTime: 5 * 60 * 1000 },
    },
  });
  // The server answers with the members whose id or handle was asked for.
  fetchMock.mockImplementation(async (route) => {
    const asked = new Set(namedIn(route));
    return {
      members: everyone.filter(
        (row) =>
          asked.has(row.userId) || asked.has(row.email?.split('@')[0] ?? ''),
      ),
    };
  });
});

afterEach(() => {
  client.clear();
  vi.clearAllMocks();
});

describe('useMemberLookup [MEMBER-R11]', () => {
  it('answers each person once looked up, found or not, without reading every member', async () => {
    const targets: MemberLookupTarget[] = [
      { userId: 'user-ada' },
      { handle: 'Noah' },
      { userId: 'user-gone' },
    ];
    const { result } = renderHook(() => useMemberLookup('org-acme', targets), {
      wrapper,
    });

    expect(result.current.answered({ userId: 'user-ada' })).toBe(false);
    expect(result.current.members).toEqual([]);
    // A value no member could be named answers at once: nobody.
    expect(result.current.answered({ handle: 'not a handle' })).toBe(true);

    await waitFor(() =>
      expect(result.current.answered({ userId: 'user-gone' })).toBe(true),
    );
    expect(result.current.answered({ handle: 'noah' })).toBe(true);
    // In the order they joined, each once.
    expect(result.current.members.map((m) => m.userId)).toEqual([
      'user-noah',
      'user-ada',
    ]);
    expect(result.current.members[1]).toEqual({
      _id: 'member-user-ada',
      userId: 'user-ada',
      role: 'member',
      createdAt: Date.parse(ada.createdAt),
      displayName: 'Ada Lovelace',
      email: 'ada@acme.example',
    });
    expect(lookupsSent()).toEqual([['user-ada', 'user-gone', 'noah']]);
    expect(fetchMock.mock.calls.some(([route]) => route === '/members')).toBe(
      false,
    );
  });

  it('answers a person another screen looked up at once, asking only for the new one', async () => {
    const first = renderHook(
      () => useMemberLookup('org-acme', [{ userId: 'user-ada' }]),
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current.answered({ userId: 'user-ada' })).toBe(true),
    );

    const second = renderHook(
      () =>
        useMemberLookup('org-acme', [
          { userId: 'user-ada' },
          { userId: 'user-noah' },
        ]),
      { wrapper },
    );

    expect(second.result.current.answered({ userId: 'user-ada' })).toBe(true);
    expect(second.result.current.answered({ userId: 'user-noah' })).toBe(false);
    await waitFor(() =>
      expect(second.result.current.answered({ userId: 'user-noah' })).toBe(
        true,
      ),
    );
    expect(lookupsSent()).toEqual([['user-ada'], ['user-noah']]);
  });

  it('looks everyone up again, together, when a member changes', async () => {
    const { result } = renderHook(
      () =>
        useMemberLookup('org-acme', [
          { userId: 'user-ada' },
          { userId: 'user-noah' },
        ]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.members).toHaveLength(2));

    await act(() =>
      client.invalidateQueries({
        queryKey: backendEntityPrefix('org-acme', MEMBER_HINT_ENTITY),
      }),
    );

    expect(lookupsSent()).toEqual([
      ['user-ada', 'user-noah'],
      ['user-ada', 'user-noah'],
    ]);
  });

  it('keeps a person pending while their lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('backend unreachable'));
    const { result } = renderHook(
      () => useMemberLookup('org-acme', [{ userId: 'user-ada' }]),
      { wrapper },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(result.current.answered({ userId: 'user-ada' })).toBe(false);
  });
});

describe('useAskedMemberLookup [MEMBER-R11]', () => {
  it('looks up whom its readers name as they render, in one request', async () => {
    const { result } = renderHook(
      () => {
        const lookup = useAskedMemberLookup('org-acme');
        // What a reader does while it renders the people it shows.
        const adaPending = lookup.pending({ userId: 'user-ada' });
        const gonePending = lookup.pending({ userId: 'user-gone' });
        return { lookup, adaPending, gonePending };
      },
      { wrapper },
    );

    expect(result.current.adaPending).toBe(true);
    expect(result.current.gonePending).toBe(true);

    await waitFor(() => expect(result.current.gonePending).toBe(false));
    expect(result.current.adaPending).toBe(false);
    expect(result.current.lookup.members.map((m) => m.userId)).toEqual([
      'user-ada',
    ]);
    expect(lookupsSent()).toEqual([['user-ada', 'user-gone']]);
  });

  it('asks afresh for another organization', async () => {
    const { result, rerender } = renderHook(
      ({ organizationId }) => {
        const lookup = useAskedMemberLookup(organizationId);
        return lookup.pending({ userId: 'user-ada' });
      },
      { wrapper, initialProps: { organizationId: 'org-acme' } },
    );
    await waitFor(() => expect(result.current).toBe(false));

    rerender({ organizationId: 'org-globex' });

    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
    expect(fetchMock.mock.calls.map(([, options]) => options?.orgId)).toEqual([
      'org-acme',
      'org-globex',
    ]);
  });
});
