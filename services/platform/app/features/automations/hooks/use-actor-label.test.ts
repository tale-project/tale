// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from '@/app/lib/backend/api-client';
import type { MemberLookupWire } from '@/app/lib/backend/member-lookup-batch';
import { act, renderHook, waitFor } from '@/tests/utils/render';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

import { useActorLabel } from './use-actor-label';

const fetchMock = vi.mocked(backendFetch);

function member(
  userId: string,
  displayName: string | null,
  email: string,
): MemberLookupWire {
  return {
    id: `member-${userId}`,
    userId,
    role: 'member',
    createdAt: '2026-01-01 09:00:00+00',
    displayName,
    email,
  };
}

const MEMBERS = [
  member('user-ada', 'Ada Lovelace', 'ada@x.test'),
  member('user-noname', '', 'noname@x.test'),
];

/** The server: it answers with the members whose id was asked for. */
async function answerLookup(route: string) {
  const asked = new Set(
    new URLSearchParams(route.split('?')[1]).get('userIds')?.split(','),
  );
  return { members: MEMBERS.filter((row) => asked.has(row.userId)) };
}

/** The user ids each lookup request named. */
function lookupsSent(): string[][] {
  return fetchMock.mock.calls.map(([route]) =>
    (new URLSearchParams(route.split('?')[1]).get('userIds') ?? '').split(','),
  );
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/** The labels a render names, as a page renders them. */
function renderLabels(...actors: string[]) {
  return renderHook(
    () => {
      const label = useActorLabel('org-1');
      return actors.map((actor) => label(actor));
    },
    { wrapper },
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: Infinity, staleTime: 5 * 60 * 1000 },
    },
  });
  fetchMock.mockImplementation(answerLookup);
});

afterEach(() => {
  client.clear();
  vi.clearAllMocks();
});

describe('useActorLabel', () => {
  it('names the reader, in every form an actor takes, without a lookup', () => {
    const { result } = renderLabels(
      'user-me',
      'user:user-me',
      'api-key:user-me',
    );
    expect(result.current).toEqual([
      { kind: 'you', api: false },
      { kind: 'you', api: false },
      { kind: 'you', api: true },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up whom a render names, together, and names a member by name, else by e-mail', async () => {
    const { result } = renderLabels('user-ada', 'api-key:user-noname');
    expect(result.current).toEqual([
      { kind: 'pending', api: false },
      { kind: 'pending', api: true },
    ]);

    await waitFor(() =>
      expect(result.current).toEqual([
        { kind: 'member', name: 'Ada Lovelace', api: false },
        { kind: 'member', name: 'noname@x.test', api: true },
      ]),
    );
    // One request for the people named, never the whole member list.
    expect(lookupsSent()).toEqual([['user-ada', 'user-noname']]);
    expect(fetchMock.mock.calls.every(([route]) => route !== '/members')).toBe(
      true,
    );
  });

  it('waits for the lookup before calling anyone a former member', async () => {
    const { result } = renderLabels('user-gone', 'erased-user');
    expect(result.current).toEqual([
      { kind: 'pending', api: false },
      { kind: 'pending', api: false },
    ]);
    // The pseudonym erasure leaves behind reads as a former member too.
    await waitFor(() =>
      expect(result.current).toEqual([
        { kind: 'former', api: false },
        { kind: 'former', api: false },
      ]),
    );
  });

  it('says a name is unavailable, not pending, once its lookup has failed, and names them once a retry answers', async () => {
    fetchMock.mockRejectedValue(new Error('backend unreachable'));
    const { result } = renderLabels(
      'user-ada',
      'api-key:user-gone',
      'user-me',
      'system:provisioning',
    );

    await waitFor(() =>
      expect(result.current).toEqual([
        { kind: 'unavailable', api: false },
        { kind: 'unavailable', api: true },
        // Neither the reader nor the platform needs the lookup.
        { kind: 'you', api: false },
        { kind: 'system' },
      ]),
    );

    fetchMock.mockImplementation(answerLookup);
    await act(() => client.refetchQueries());

    await waitFor(() =>
      expect(result.current.slice(0, 2)).toEqual([
        { kind: 'member', name: 'Ada Lovelace', api: false },
        { kind: 'former', api: true },
      ]),
    );
  });

  it('names the platform as Tale, and an actor that names nobody as unknown', () => {
    const { result } = renderLabels(
      'system:provisioning',
      '',
      'trigger:t-1',
      'odd:value',
    );
    expect(result.current).toEqual([
      { kind: 'system' },
      { kind: 'unknown' },
      { kind: 'unknown' },
      { kind: 'unknown' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
