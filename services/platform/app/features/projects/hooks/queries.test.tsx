import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, waitFor } from '@/tests/utils/render';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '../lib/project-choices';
import { useNamedProjects, useProjectChoices } from './queries';

/**
 * A project picker offers Home's navigator page and, past it, what the
 * server finds by name for what was typed — never the whole list (#5194). A
 * screen that names projects reads the page and, by id, each one past it
 * (#5204). Real hooks, real adapter rows and a real query client; only
 * `fetch` is stubbed, answering like the backend.
 */

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

const PAGE = Array.from({ length: 100 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
}));

/** Projects past the page, which only a read by id reaches. */
const PAST_PAGE = [
  { id: 'p-150', name: 'Project 150' },
  { id: 'p-160', name: 'Project 160', archivedAt: 7 },
];

let queryClient: QueryClient;
/** Every request, as path and query string. */
let gets: string[] = [];
/** Whether the navigator's page holds every project. */
let pageIsDone = false;
/** Whether the navigator's page is refused. */
let pageFails = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `GET /projects/:id`: the project, or 404 for one gone or out of reach. */
function projectById(id: string): Response {
  const project = [...PAGE, ...PAST_PAGE].find((row) => row.id === id);
  if (project === undefined) return json({ error: 'NOT_FOUND' }, 404);
  return json({
    project: {
      archivedAt: null,
      ...project,
      organizationId: 'org-1',
      description: null,
      icon: null,
      color: null,
      key: null,
      externalItemId: null,
      taskCounter: 0,
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
      teamId: null,
      sharedWithTeamIds: [],
      teamIds: [],
      instructions: null,
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    },
  });
}

function answer(url: URL): Response {
  if (url.pathname === '/api/app/projects/search') {
    return json({
      projects: [
        { id: 'p-10', name: 'Project 10' },
        { id: 'p-101', name: 'Project 101' },
        { id: 'p-1010', name: 'Project 1010', archivedAt: 5 },
      ],
    });
  }
  if (url.pathname === '/api/app/projects/sidebar') {
    if (pageFails) return json({ error: 'FORBIDDEN' }, 403);
    return json({
      projects: pageIsDone ? PAGE.slice(0, 3) : PAGE,
      isDone: pageIsDone,
    });
  }
  const id = /^\/api\/app\/projects\/([^/]+)$/.exec(url.pathname)?.[1];
  if (id !== undefined) return projectById(decodeURIComponent(id));
  return json({ error: 'NOT_FOUND' }, 404);
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  pageIsDone = false;
  pageFails = false;
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    gets.push(`${url.pathname}${url.search}`);
    return Promise.resolve(answer(url));
  });
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('useProjectChoices', () => {
  it('adds what the server finds past the page, archived projects dropped', async () => {
    const { result, rerender } = renderHook(
      ({ query }) => useProjectChoices('org-1', query),
      { wrapper, initialProps: { query: '' } },
    );
    await waitFor(() => expect(result.current.projects).toHaveLength(100));
    expect(result.current.isDone).toBe(false);

    rerender({ query: ' Project 10 ' });

    await waitFor(() => expect(result.current.projects).toHaveLength(101), {
      timeout: 2_000,
    });
    expect(result.current.projects.at(-1)).toMatchObject({
      _id: 'p-101',
      name: 'Project 101',
    });
    // The page and the one search: never the whole list.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/search?q=Project%2010&summary=true&orgId=org-1',
    ]);
    expect(gets.some((get) => get.startsWith('/api/app/projects?'))).toBe(
      false,
    );
  });

  it('asks the server nothing once the page holds every project', async () => {
    pageIsDone = true;
    const { result } = renderHook(
      () => useProjectChoices('org-1', 'Project 2'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.projects).toHaveLength(3));
    expect(result.current.isDone).toBe(true);

    // Past the debounce: still no search.
    await new Promise((resolve) =>
      setTimeout(resolve, PROJECT_SEARCH_DEBOUNCE_MS + 100),
    );
    expect(gets).toEqual([PAGE_READ]);
  });
});

describe('useNamedProjects', () => {
  /** Each named project's name, by id. */
  function names(projects: ReadonlyMap<string, { name: string }>) {
    return Object.fromEntries(
      [...projects].map(([id, project]) => [id, project.name]),
    );
  }

  it('names a project on the page from the page, one past it by id, archived ones too', async () => {
    const { result } = renderHook(
      () => useNamedProjects('org-1', ['p-160', 'p-2', 'p-150', 'p-2']),
      { wrapper },
    );
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(names(result.current.projects)).toEqual({
      'p-2': 'Project 2',
      'p-150': 'Project 150',
      'p-160': 'Project 160',
    });
    expect(result.current.projects.get('p-160')?.archivedAt).toBe(7);
    // The page, then each id it lacks: never the whole list.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/p-150?orgId=org-1',
      '/api/app/projects/p-160?orgId=org-1',
    ]);
  });

  it('leaves out a project that is gone or out of reach', async () => {
    const { result } = renderHook(() => useNamedProjects('org-1', ['p-404']), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.projects.size).toBe(0);
    expect(gets).toEqual([PAGE_READ, '/api/app/projects/p-404?orgId=org-1']);
  });

  it('reads each id on its own when the page cannot be read', async () => {
    pageFails = true;
    const { result } = renderHook(() => useNamedProjects('org-1', ['p-2']), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(names(result.current.projects)).toEqual({ 'p-2': 'Project 2' });
    expect(gets).toEqual([PAGE_READ, '/api/app/projects/p-2?orgId=org-1']);
  });

  it('reads nothing when it names no project', async () => {
    const { result } = renderHook(() => useNamedProjects('org-1', []), {
      wrapper,
    });
    expect(result.current.isPending).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.projects.size).toBe(0);
    expect(gets).toEqual([]);
  });
});
