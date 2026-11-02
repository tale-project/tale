// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

/**
 * The project metrics' scope over more projects than Home's page holds
 * (#5205): a `?project=` past the page is read by id and named, and what is
 * typed is searched on the server. The projects' hooks and adapter rows are
 * real; `fetch` is stubbed, answering like the backend. The route's params,
 * search and navigation are stubbed, and the metrics page is a stand-in that
 * shows the scope picker it is handed.
 */
const route = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
    useSearch: () => route.search,
  }),
  useNavigate: () => route.navigate,
}));
vi.mock('@/app/features/tasks/components/project-metrics-page', () => ({
  ProjectMetricsPage: ({
    scopeControl,
    projectId,
  }: {
    scopeControl: ReactNode;
    projectId: string;
  }) => (
    <section aria-label={`Metrics of ${projectId}`}>{scopeControl}</section>
  ),
}));

const { Route } = await import('./projects');
const ProjectsMetricsRoute = (Route as unknown as { component: ComponentType })
  .component;

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

/** 120 projects; the page holds the first 100. */
const PROJECTS = Array.from({ length: 120 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
}));

let queryClient: QueryClient;
/** Every request, as path and query string. */
let gets: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function answer(url: URL): Response {
  if (url.pathname === '/api/app/projects/sidebar') {
    return json({ projects: PROJECTS.slice(0, 100), isDone: false });
  }
  if (url.pathname === '/api/app/projects/search') {
    const term = (url.searchParams.get('q') ?? '').toLowerCase();
    return json({
      projects: PROJECTS.filter((project) =>
        project.name.toLowerCase().includes(term),
      ).slice(0, 20),
    });
  }
  const id = /^\/api\/app\/projects\/([^/]+)$/.exec(url.pathname)?.[1];
  const project = PROJECTS.find((row) => row.id === id);
  if (project === undefined) return json({ error: 'NOT_FOUND' }, 404);
  return json({
    project: {
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
      archivedAt: null,
    },
  });
}

function renderRoute(search: Record<string, unknown>) {
  route.search = search;
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectsMetricsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  route.navigate.mockReset();
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

describe('project metrics over more projects than a page', () => {
  it('names the scoped project past the page, read by id', async () => {
    renderRoute({ project: 'p-120' });

    expect(
      await screen.findByRole('button', { name: 'Project: Project 120' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Metrics of p-120' }),
    ).toBeInTheDocument();
    // The page, then the scoped project it lacks: never the whole list.
    expect(gets).toEqual([PAGE_READ, '/api/app/projects/p-120?orgId=org-1']);
  });

  it('scopes to a project past the page, found by the server search', async () => {
    const { user } = renderRoute({});

    const picker = await screen.findByRole('button', {
      name: 'Select a project',
    });
    await waitFor(() => expect(gets).toEqual([PAGE_READ]));
    await user.click(picker);
    expect(
      screen.queryByRole('option', { name: 'Project 115' }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('combobox', { name: 'Search projects' }),
      'Project 115',
    );
    await user.click(
      await screen.findByRole(
        'option',
        { name: 'Project 115' },
        { timeout: 2_000 },
      ),
    );

    expect(route.navigate).toHaveBeenCalledTimes(1);
    const [{ search }] = route.navigate.mock.calls[0] as [
      { search: (prev: Record<string, unknown>) => Record<string, unknown> },
    ];
    expect(search({ period: '30' })).toEqual({
      period: '30',
      project: 'p-115',
    });
    // The page and the search: never the whole list.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/search?q=Project%20115&summary=true&orgId=org-1',
    ]);
  });
});
