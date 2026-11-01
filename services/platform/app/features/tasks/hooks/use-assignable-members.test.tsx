import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from '@/app/lib/backend/api-client';
import type { MemberLookupWire } from '@/app/lib/backend/member-lookup-batch';
import { renderHook, waitFor } from '@/tests/utils/render';

import { useAssignableMembers } from './use-assignable-members';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));
// The task surfaces' tests replace the actor directory with stand-ins that
// name only the hooks they stub, and a browser links every named import:
// the hook takes nothing from it, so it runs beside any of them.
vi.mock('./use-actor-directory', () => ({}));

const fetchMock = vi.mocked(backendFetch);

function member(
  userId: string,
  role: string,
  displayName: string,
  day: number,
): MemberLookupWire {
  return {
    id: `member-${userId}`,
    userId,
    role,
    createdAt: `2026-01-0${day} 09:00:00+00`,
    displayName,
    email: `${userId}@acme.example`,
  };
}

const ada = member('user-ada', 'member', 'Ada Lovelace', 1);
const noah = member('user-noah', 'editor', 'Noah Berg', 2);
const gone = member('user-gone', 'disabled', 'Gus Gone', 3);

/** The viewer, as `GET /members/me` and the lookup know them. */
let viewer: MemberLookupWire;
/** The page each search finds: the server's own matching is not under
 * test here, only what the hook offers from its answer. */
let page: MemberLookupWire[];

/** The backend: the viewer's context, the lookup by user id (MEMBER-R11)
 * and the search (MEMBER-R12). */
function answer(route: string): unknown {
  const [path = '', query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  if (path === '/members/me') {
    return {
      status: 'ok',
      memberId: viewer.id,
      organizationId: 'org-1',
      userId: viewer.userId,
      role: viewer.role,
      createdAt: Date.parse(viewer.createdAt),
      displayName: viewer.displayName ?? undefined,
      isAdmin: false,
    };
  }
  if (path === '/members/lookup') {
    const userIds = (params.get('userIds') ?? '').split(',');
    return {
      members: [viewer, ada, noah, gone].filter((row) =>
        userIds.includes(row.userId),
      ),
    };
  }
  if (path === '/members/search') {
    return { members: page, isDone: false, continueCursor: 'next' };
  }
  throw new Error(`unexpected route ${route}`);
}

/** What each search asked: its query, without the route. */
function searchesSent(): Array<Record<string, string>> {
  return fetchMock.mock.calls
    .map(([route]) => route.split('?'))
    .filter(([path]) => path === '/members/search')
    .map(([, query]) => Object.fromEntries(new URLSearchParams(query)));
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPeople(
  access: 'read' | 'edit',
  options: { projectId?: string; chosenUserId?: string } = {},
) {
  const { result } = renderHook(
    () =>
      useAssignableMembers(
        'org-1',
        'projectId' in options ? options.projectId : 'project-1',
        '',
        access,
        options.chosenUserId,
      ),
    { wrapper },
  );
  return result;
}

const offered = (result: ReturnType<typeof renderPeople>) =>
  result.current.members.map((person) => person.id);

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  viewer = member('user-me', 'editor', 'Mia Viewer', 4);
  page = [ada];
  fetchMock.mockImplementation(async (route) => answer(route));
});

afterEach(() => {
  client.clear();
  vi.clearAllMocks();
});

describe('useAssignableMembers', () => {
  it('offers what the search found with the viewer first', async () => {
    page = [ada, viewer, noah];
    const result = renderPeople('read');
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-me', 'user-ada', 'user-noah']),
    );
    expect(result.current.more).toBe(true);
    expect(result.current.members[0]).toMatchObject({
      type: 'user',
      id: 'user-me',
      name: 'Mia Viewer',
      email: 'user-me@acme.example',
    });
  });

  it('adds the viewer the page lacks while their role may take the task', async () => {
    viewer = member('user-me', 'member', 'Mia Viewer', 4);
    const reader = renderPeople('read');
    await waitFor(() =>
      expect(offered(reader)).toEqual(['user-me', 'user-ada']),
    );

    viewer = member('user-me', 'owner', 'Mia Viewer', 4);
    client.clear();
    const editor = renderPeople('edit');
    await waitFor(() =>
      expect(offered(editor)).toEqual(['user-me', 'user-ada']),
    );
  });

  // The viewer and the chosen person are looked up together, so once the
  // chosen one shows, the viewer's answer is in too.
  it('leaves out a disabled viewer under read', async () => {
    viewer = member('user-me', 'disabled', 'Mia Viewer', 4);
    const result = renderPeople('read', { chosenUserId: 'user-noah' });
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-noah', 'user-ada']),
    );
  });

  it('leaves out a viewer who may not edit under edit', async () => {
    viewer = member('user-me', 'member', 'Mia Viewer', 4);
    const result = renderPeople('edit', { chosenUserId: 'user-noah' });
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-noah', 'user-ada']),
    );
  });

  it('keeps the chosen person the page lacks offered right after the viewer', async () => {
    const result = renderPeople('read', { chosenUserId: 'user-noah' });
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-me', 'user-noah', 'user-ada']),
    );
    expect(result.current.members[1]).toMatchObject({
      id: 'user-noah',
      name: 'Noah Berg',
    });
  });

  it('leaves the chosen person where the page found them', async () => {
    page = [noah, ada];
    const result = renderPeople('read', { chosenUserId: 'user-ada' });
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-me', 'user-noah', 'user-ada']),
    );
  });

  it('offers the viewer once when they are the chosen person', async () => {
    const result = renderPeople('edit', { chosenUserId: 'user-me' });
    await waitFor(() =>
      expect(offered(result)).toEqual(['user-me', 'user-ada']),
    );
  });

  it('keeps no chosen person whose role may not take the task', async () => {
    // Ada is a member: she may hold a task but not review it.
    page = [noah];
    const reviewer = renderPeople('edit', { chosenUserId: 'user-ada' });
    await waitFor(() =>
      expect(offered(reviewer)).toEqual(['user-me', 'user-noah']),
    );

    client.clear();
    const assignee = renderPeople('read', { chosenUserId: 'user-gone' });
    await waitFor(() =>
      expect(offered(assignee)).toEqual(['user-me', 'user-noah']),
    );
  });

  it('scopes the search to the project, and sends no project without one', async () => {
    const inProject = renderPeople('edit');
    await waitFor(() => expect(inProject.current.searching).toBe(false));
    const withoutProject = renderPeople('read', { projectId: undefined });
    await waitFor(() => expect(withoutProject.current.searching).toBe(false));
    expect(searchesSent()).toEqual([
      { q: '', projectId: 'project-1', access: 'edit' },
      { q: '', access: 'read' },
    ]);
  });

  it('says when the search failed, still offering the viewer', async () => {
    fetchMock.mockImplementation(async (route) => {
      if (route.startsWith('/members/search')) throw new Error('down');
      return answer(route);
    });
    const result = renderPeople('read');
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    await waitFor(() => expect(offered(result)).toEqual(['user-me']));
  });
});
