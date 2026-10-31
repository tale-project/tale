import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, waitFor } from '@/tests/utils/render';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '../lib/project-choices';
import { useProjectChoices } from './queries';

/**
 * A project picker offers Home's navigator page and, past it, what the
 * server finds by name for what was typed — never the whole list (#5194).
 * Real hooks, real adapter rows and a real query client; only `fetch` is
 * stubbed, answering like the backend.
 */

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

const PAGE = Array.from({ length: 100 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
}));

let queryClient: QueryClient;
/** Every request, as path and query string. */
let gets: string[] = [];
/** Whether the navigator's page holds every project. */
let pageIsDone = false;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    gets.push(`${url.pathname}${url.search}`);
    return Promise.resolve(
      url.pathname === '/api/app/projects/search'
        ? json({
            projects: [
              { id: 'p-10', name: 'Project 10' },
              { id: 'p-101', name: 'Project 101' },
              { id: 'p-1010', name: 'Project 1010', archivedAt: 5 },
            ],
          })
        : json({
            projects: pageIsDone ? PAGE.slice(0, 3) : PAGE,
            isDone: pageIsDone,
          }),
    );
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
