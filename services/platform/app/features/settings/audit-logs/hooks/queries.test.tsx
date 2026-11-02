import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useActorEmails,
  useListAuditLogsPaginated,
  useListErrorLogsPaginated,
} from './queries';

/**
 * The logs page watches the listing its active tab reads, so the two must be
 * one cache entry fetched once, with one page size; and a caller with no
 * organization to read for (the tab not on show, a refused page) must fetch
 * nothing. Real hooks, real adapter rows and a real query client; only
 * `fetch` is stubbed, answering an empty trail.
 */

/** The members `GET /members/lookup` knows. */
const MEMBERS = [
  {
    id: 'member-ada',
    userId: 'user-ada',
    role: 'member',
    createdAt: '2026-01-01 09:00:00+00',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
  },
  {
    id: 'member-noah',
    userId: 'user-noah',
    role: 'admin',
    createdAt: '2026-01-02 09:00:00+00',
    displayName: 'Noah Weber',
    email: 'noah@example.com',
  },
];

let queryClient: QueryClient;
/** Every listing request, as path and query string. */
let gets: string[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  gets = [];
  window.__ENV__ = { BASE_PATH: '' };
  // On the logs page, as in the app: an adapter row falls back to the URL's
  // organization, so only the hooks' skip keeps an org-less read from going
  // out.
  window.history.pushState({}, '', '/dashboard/org-1/settings/logs');
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    gets.push(`${url.pathname}${url.search}`);
    // The member lookup answers with the members whose id was asked for.
    const body =
      url.pathname === '/api/app/members/lookup'
        ? {
            members: MEMBERS.filter((member) =>
              url.searchParams
                .get('userIds')
                ?.split(',')
                .includes(member.userId),
            ),
          }
        : { items: [], nextCursor: null };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
  window.history.pushState({}, '', '/');
});

describe.each([
  ['useListAuditLogsPaginated', useListAuditLogsPaginated, '/audit-logs'],
  [
    'useListErrorLogsPaginated',
    useListErrorLogsPaginated,
    '/audit-logs/errors',
  ],
] as const)('%s', (_name, useListing, route) => {
  it('reads one page of 30, once, for the page and its tab alike', async () => {
    const { result } = renderHook(
      () => [
        useListing({ organizationId: 'org-1', category: 'security' }),
        useListing({ organizationId: 'org-1', category: 'security' }),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.map((listing) => listing.status)).toEqual([
        'Exhausted',
        'Exhausted',
      ]),
    );
    expect(gets).toEqual([
      `/api/app${route}?limit=30&category=security&orgId=org-1`,
    ]);
  });

  it('fetches nothing when there is no organization to read for', async () => {
    const { result } = renderHook(
      () => useListing({ organizationId: undefined, category: 'security' }),
      { wrapper },
    );
    // Let any request the hook might start reach the stub.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.status).toBe('LoadingFirstPage');
    expect(result.current.results).toEqual([]);
    expect(gets).toEqual([]);
  });
});

describe('useActorEmails [MEMBER-R11]', () => {
  /** The user ids each member lookup asked for, in any order. */
  function lookups(): string[][] {
    return gets
      .filter((path) => path.startsWith('/api/app/members/lookup?'))
      .map((path) =>
        (new URLSearchParams(path.split('?')[1]).get('userIds') ?? '')
          .split(',')
          .sort(),
      );
  }

  // Ada and Noah's key acted without an address on the row; the row of a
  // former member, the platform and an automation follow.
  const actors = [
    { actorId: 'user-ada', actorType: 'user' },
    { actorId: 'user-noah', actorType: 'api' },
    { actorId: 'user-gone', actorType: 'user' },
    { actorId: 'user-eve', actorType: 'user', actorEmail: 'eve@example.com' },
    { actorId: 'system', actorType: 'system' },
    { actorId: 'automation-1', actorType: 'workflow' },
  ];

  it('looks up, together, the people named without an e-mail, and nobody else', async () => {
    const { result } = renderHook(() => useActorEmails('org-1', actors), {
      wrapper,
    });
    await waitFor(() =>
      expect([...result.current]).toEqual([
        ['user-ada', 'ada@example.com'],
        ['user-noah', 'noah@example.com'],
      ]),
    );
    expect(lookups()).toEqual([['user-ada', 'user-gone', 'user-noah']]);
    // Never the whole member list.
    expect(
      gets.filter((path) => !path.startsWith('/api/app/members/lookup?')),
    ).toEqual([]);
  });

  it('looks up every top actor of the roll-up without one, which records no type', async () => {
    const topActors = [
      { actorId: 'user-ada', actorEmail: 'ada@example.com', count: 7 },
      { actorId: 'user-noah', count: 3 },
    ];
    const { result } = renderHook(() => useActorEmails('org-1', topActors), {
      wrapper,
    });
    await waitFor(() =>
      expect([...result.current]).toEqual([['user-noah', 'noah@example.com']]),
    );
    expect(lookups()).toEqual([['user-noah']]);
  });

  it('reads nothing without an organization', async () => {
    const { result } = renderHook(() => useActorEmails(undefined, actors), {
      wrapper,
    });
    // Let any request the hook might start reach the stub.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.size).toBe(0);
    expect(gets).toEqual([]);
  });
});
