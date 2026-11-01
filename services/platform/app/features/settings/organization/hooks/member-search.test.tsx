import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import type { MemberLookupWire } from '@/app/lib/backend/member-lookup-batch';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { MEMBER_HINT_ENTITY } from '@/lib/shared/hint-entities';
import { renderHook, waitFor } from '@/tests/utils/render';

import { type MemberSearchOptions, useMemberSearch } from './member-search';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));

const fetchMock = vi.mocked(backendFetch);

const ada: MemberLookupWire = {
  id: 'member-ada',
  userId: 'user-ada',
  role: 'member',
  createdAt: '2026-01-01 09:00:00+00',
  displayName: 'Ada Lovelace',
  email: 'ada@acme.example',
};
const noah: MemberLookupWire = {
  id: 'member-noah',
  userId: 'user-noah',
  role: 'editor',
  createdAt: '2026-01-02 09:00:00+00',
  displayName: null,
  email: 'noah@acme.example',
};

/** What each request asked: its route and its query. */
function searchesSent(): Array<Record<string, string>> {
  return fetchMock.mock.calls.map(([route, init]) => {
    const [path, query] = route.split('?');
    return {
      path: path ?? '',
      orgId: String(init?.orgId),
      ...Object.fromEntries(new URLSearchParams(query)),
    };
  });
}

/** The server's answer: everyone whose name or email holds the text, one
 * member to a page when nothing was typed. */
function answer(route: string) {
  const q = new URLSearchParams(route.split('?')[1]).get('q') ?? '';
  const found = [ada, noah].filter((row) =>
    [row.displayName, row.email].some((text) =>
      text?.toLowerCase().includes(q.toLowerCase()),
    ),
  );
  return q === ''
    ? { members: found.slice(0, 1), isDone: false, continueCursor: 'next' }
    : { members: found, isDone: true, continueCursor: '' };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderSearch(query: string, options: MemberSearchOptions = {}) {
  return renderHook(
    (props: { query: string; options: MemberSearchOptions }) =>
      useMemberSearch('org-1', props.query, props.options),
    { wrapper, initialProps: { query, options } },
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  fetchMock.mockImplementation(async (route) => answer(route));
});

afterEach(() => {
  client.clear();
  vi.clearAllMocks();
});

describe('useMemberSearch [MEMBER-R12]', () => {
  it('searches what was typed on the server once typing pauses, never reading every member', async () => {
    const { result, rerender } = renderSearch('', {
      projectId: 'project-1',
      access: 'edit',
    });

    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.members.map((m) => m.userId)).toEqual(['user-ada']);
    expect(result.current.more).toBe(true);

    rerender({
      query: '  noah ',
      options: { projectId: 'project-1', access: 'edit' },
    });
    // The page found before stays until the new text's answer lands.
    expect(result.current.searching).toBe(true);
    expect(result.current.members.map((m) => m.userId)).toEqual(['user-ada']);

    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.members).toEqual([
      {
        _id: 'member-noah',
        userId: 'user-noah',
        role: 'editor',
        createdAt: Date.parse('2026-01-02 09:00:00+00'),
        email: 'noah@acme.example',
      },
    ]);
    expect(result.current.more).toBe(false);
    expect(searchesSent()).toEqual([
      {
        path: '/members/search',
        orgId: 'org-1',
        q: '',
        projectId: 'project-1',
        access: 'edit',
      },
      {
        path: '/members/search',
        orgId: 'org-1',
        q: 'noah',
        projectId: 'project-1',
        access: 'edit',
      },
    ]);
  });

  it('searches a text that differs only in its spaces once', async () => {
    const { result, rerender } = renderSearch('ada  love');
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    rerender({ query: ' ada love ', options: {} });
    expect(result.current.searching).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(searchesSent().map((sent) => sent.q)).toEqual(['ada love']);
  });

  it("never shows what another project's search found while its own loads", async () => {
    const { result, rerender } = renderSearch('a', { projectId: 'project-1' });
    await waitFor(() => expect(result.current.members).toHaveLength(2));

    let release = () => {};
    fetchMock.mockImplementationOnce(
      (route) =>
        new Promise((resolve) => {
          release = () => resolve(answer(route));
        }),
    );
    rerender({ query: 'a', options: { projectId: 'project-2' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.members).toEqual([]);
    expect(result.current.searching).toBe(true);
    release();
    await waitFor(() => expect(result.current.members).toHaveLength(2));
    expect(searchesSent()[1]).toMatchObject({ projectId: 'project-2' });
  });

  it('finds nobody for a text longer than the server takes, without asking it', async () => {
    const { result } = renderSearch('a'.repeat(201));
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.members).toEqual([]);
    expect(result.current.more).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads nothing until it is enabled', async () => {
    const { result, rerender } = renderSearch('', { enabled: false });
    expect(result.current.searching).toBe(false);
    expect(result.current.members).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ query: '', options: {} });
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says a failed search is unavailable rather than finding nobody', async () => {
    fetchMock.mockRejectedValue(
      new BackendApiError(404, 'Project not found', 'PROJECT_NOT_FOUND'),
    );
    const { result } = renderSearch('ada', { projectId: 'project-gone' });

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.members).toEqual([]);
  });

  it('keys under the member entity, so a member write refreshes it', async () => {
    const { result } = renderSearch('ada');
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    expect(
      client.getQueryCache().findAll({
        queryKey: backendEntityPrefix('org-1', MEMBER_HINT_ENTITY),
      }),
    ).toHaveLength(1);
  });
});
