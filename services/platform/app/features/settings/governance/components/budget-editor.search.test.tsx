// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '@/app/features/projects/lib/project-choices';
import { render, screen, waitFor, within } from '@/tests/utils/render';

/**
 * Project caps over more projects than Home's page holds (#5205): the table
 * names each project a rule caps by id when the page lacks it, archived or
 * gone, and the rule dialog finds a project past the page through the
 * server search. The projects' hooks and adapter rows are real; `fetch` is
 * stubbed, answering like the backend, and the policy files, members, teams
 * and the save are stubbed as in budget-editor.test.tsx.
 */
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const upsert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: upsert, isPending: false }),
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));
const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

// Each policy read is one object per test, as the hook's result holds until
// the data changes (budget-editor.test.tsx says why that matters).
const policies = vi.hoisted(() => ({
  budgets: {
    data: { config: { enabled: true, rules: [] as unknown[] } },
    isLoading: false,
  },
  projectBudgets: {
    data: { config: { rules: [] as unknown[] } },
    isLoading: false,
  },
}));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: (_organizationId: string, policyType: string) =>
    policyType === 'project_budgets'
      ? policies.projectBudgets
      : policies.budgets,
}));

import { BudgetEditor } from './budget-editor';

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

/** 120 active projects; the page holds the first 100. */
const PROJECTS = Array.from({ length: 120 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
  archivedAt: null as number | null,
}));
/** Archived: on no page, offered by no search, still named by id. */
const ARCHIVED = { id: 'p-old', name: 'Old campaign', archivedAt: 1 };

let queryClient: QueryClient;
/** Every request for projects, as path and query string. */
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
      projects: [...PROJECTS, ARCHIVED]
        .filter((project) => project.name.toLowerCase().includes(term))
        .slice(0, 20),
    });
  }
  const id = /^\/api\/app\/projects\/([^/]+)$/.exec(url.pathname)?.[1];
  const project = [...PROJECTS, ARCHIVED].find((row) => row.id === id);
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
    },
  });
}

/** A project's monthly cap. */
function capOf(scopeId: string) {
  return { scope: 'project', scopeId, period: 'monthly', maxCostCents: 100 };
}

function renderEditor(projectRules: unknown[] = []) {
  policies.projectBudgets = {
    data: { config: { rules: projectRules } },
    isLoading: false,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <BudgetEditor organizationId="org-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // A read stays fresh for five minutes, as the app's client keeps it
  // (router.tsx): the dialog and the table share their reads.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  });
  gets = [];
  upsert.mockClear();
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    // The API keys' list is no project read, and no rule here needs it.
    if (!url.pathname.startsWith('/api/app/projects')) {
      return Promise.resolve(json({ error: 'NOT_FOUND' }, 404));
    }
    gets.push(`${url.pathname}${url.search}`);
    return Promise.resolve(answer(url));
  });
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('BudgetEditor over more projects than a page', () => {
  it('names each project a rule caps, past the page by id, archived or gone', async () => {
    const { user } = renderEditor([
      capOf('p-3'),
      capOf('p-120'),
      capOf('p-old'),
      capOf('p-gone'),
    ]);

    expect(
      await screen.findByRole('cell', { name: 'Project 120' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Project 3' })).toBeInTheDocument();
    const archived = await screen.findByRole('cell', { name: /Old campaign/ });
    expect(within(archived).getByText('Archived')).toBeInTheDocument();
    expect(
      await screen.findByRole('cell', { name: 'Deleted project' }),
    ).toBeInTheDocument();
    // The page, then each capped project it lacks: never the whole list.
    expect([...gets].sort()).toEqual([
      '/api/app/projects/p-120?orgId=org-1',
      '/api/app/projects/p-gone?orgId=org-1',
      '/api/app/projects/p-old?orgId=org-1',
      PAGE_READ,
    ]);

    // The rule's dialog names its project past the page from the same read.
    await user.click(screen.getByRole('button', { name: 'Edit rule 2' }));
    const dialog = within(await screen.findByRole('dialog'));
    const picker = dialog.getByRole('button', { name: /Project/ });
    // No new read: the page and the project by id are the table's.
    expect(picker).toHaveTextContent('Project 120');
    expect(gets).toHaveLength(4);
  });

  it('caps a project past the page, found by the server search', async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole('button', { name: /add rule/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('combobox', { name: 'Scope' }));
    await user.click(screen.getByRole('option', { name: 'Project' }));
    const picker = dialog.getByRole('button', { name: /Project/ });
    await user.click(picker);
    expect(
      await screen.findByRole('option', { name: 'Project 100' }),
    ).toBeInTheDocument();
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

    // The search box reset on close, and past the debounce the search's hits
    // left the offer; the field still names the pick.
    await new Promise((resolve) =>
      setTimeout(resolve, PROJECT_SEARCH_DEBOUNCE_MS + 100),
    );
    expect(picker).toHaveTextContent('Project 115');
    // The page and the search: never the whole list.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/search?q=Project%20115&summary=true&orgId=org-1',
    ]);
    await user.type(dialog.getByLabelText(/max cost/i), '50');
    await user.click(dialog.getByRole('button', { name: /confirm/i }));

    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          policyType: 'project_budgets',
          config: {
            rules: [expect.objectContaining({ scopeId: 'p-115' })],
          },
        }),
      ),
    );
    // The table names the new cap's project by id, as it names every
    // project a rule caps past the page.
    expect(
      await screen.findByRole('cell', { name: 'Project 115' }),
    ).toBeInTheDocument();
    expect(gets.slice(2)).toEqual(['/api/app/projects/p-115?orgId=org-1']);
  });
});
