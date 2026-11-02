// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '@/app/features/projects/lib/project-choices';
import { render, screen, waitFor } from '@/tests/utils/render';

/**
 * A key for a project, over more projects than Home's page holds (#5205):
 * what is typed is searched on the server, a project past the page can own
 * the key and stays named, and an archived project the search answers is
 * never offered. The projects' hooks and adapter rows are real; `fetch` is
 * stubbed, answering like the backend, and the members and teams lists are
 * stubbed as in api-key-create-dialog.test.tsx.
 */
const mockCreateKey = vi
  .fn()
  .mockResolvedValue({ key: 'tale_generated-api-key' });

const lists = vi.hoisted(() => ({
  members: {
    data: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: () => undefined,
  },
  teams: {
    teams: [],
    isLoading: false,
    unavailable: false,
    stale: false,
    retrying: false,
    failureCount: 0,
    retry: () => undefined,
  },
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../hooks/use-api-keys', () => ({
  useCreateApiKey: () => ({ mutateAsync: mockCreateKey, isPending: false }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useOrgMembersForPicker: () => lists.members,
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => lists.teams,
}));

import { ApiKeyCreateDialog } from './api-key-create-dialog';

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

/** 120 projects; the page holds the first 100. Project 116 is archived. */
const PROJECTS = Array.from({ length: 120 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
  archivedAt: index + 1 === 116 ? 1 : null,
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
    // The page holds no archived project.
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
  return json({ error: 'NOT_FOUND' }, 404);
}

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeyCreateDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        canCreateForOthers
        viewerUserId="ada"
        viewerRole="admin"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  mockCreateKey.mockClear();
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

describe('ApiKeyCreateDialog over more projects than a page', () => {
  it('makes a key for a project past the page, found by the server search', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
    await user.click(screen.getByRole('option', { name: 'A project' }));
    const picker = () => screen.getByRole('button', { name: /^Project/ });
    await waitFor(() => expect(picker()).toBeEnabled());

    await user.click(picker());
    expect(
      screen.getByRole('option', { name: 'Project 100' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Project 115' }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('combobox', { name: 'Search projects...' }),
      'Project 11',
    );
    const found = await screen.findByRole(
      'option',
      { name: 'Project 115' },
      { timeout: 2_000 },
    );
    // The same answer held Project 116, which is archived: it takes no key.
    expect(
      screen.queryByRole('option', { name: 'Project 116' }),
    ).not.toBeInTheDocument();
    await user.click(found);

    // The search box reset on close, and past the debounce the search's hits
    // left the offer; the field still names the pick.
    await new Promise((resolve) =>
      setTimeout(resolve, PROJECT_SEARCH_DEBOUNCE_MS + 100),
    );
    expect(picker()).toHaveTextContent('Project 115');
    await user.type(screen.getByRole('textbox', { name: /Key name/ }), 'Sync');
    const submit = screen.getByRole('button', { name: 'Create key' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(mockCreateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: expect.objectContaining({
            kind: 'project',
            projectId: 'p-115',
          }),
        }),
      ),
    );
    // The page and the search: never the whole list, no read by id.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/search?q=Project%2011&summary=true&orgId=org-1',
    ]);
  });
});
