// @vitest-environment jsdom
/**
 * Renders a Tasks-tab document end-to-end through the registry
 * (`AutomationView` → Puck `Render` → `registerConnectedBlock` → the real
 * `Collection`/`useListPage`/`DataTable`/`bound-columns`/runtime provider),
 * mocking ONLY the Convex network layer and router/i18n infrastructure. The
 * fixture is the Tasks tab the issue-desk bundle used to ship (its desk view
 * retired in favour of the project Backlog); it stays here because it
 * exercises the exact prop grammar any view-authored Collection uses —
 * display strings are literals rendered verbatim. Pins:
 *
 *  - the exact bundle-style props (badge column spec + `valueLabels`, arg
 *    filter, `when`-gated row actions, `subjectType`) render in every data
 *    state;
 *  - a Convex server error RETHROWN into render by the paginated read (the
 *    `usePaginatedQuery` contract) degrades to the in-frame compact error —
 *    the block's title stays visible instead of the whole card vanishing
 *    into an anonymous error panel.
 */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// i18n → echo `<ns>.<key>` (the sibling suites' stand-in; not on the suspect path).
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// Router — effect/navigation hooks used by blocks; no routing is exercised.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-1' }),
  Link: ({ children, ...rest }: { children?: ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

// --- Convex network seams (the ONLY data mocks) -----------------------------
let paginatedState: {
  results: unknown[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  isLoading: boolean;
  loadMore: (n: number) => void;
};
/** Simulates the real `usePaginatedQuery` contract: a server error for a page
 *  is THROWN into the caller's render (convex/react rethrows non-cursor
 *  errors), which is exactly what tripped the block boundary in production. */
let paginatedError: Error | undefined;
let lastPaginatedArgs: unknown;
vi.mock('@/app/hooks/use-convex-paginated-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexPaginatedQuery: (_query: unknown, args: unknown) => {
    lastPaginatedArgs = args;
    if (paginatedError) throw paginatedError;
    return paginatedState;
  },
}));
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined, isLoading: true, error: null }),
}));
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('convex/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

// ----------------------------------------------------------------------------
import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { AutomationView } from './automation-view';

// The Tasks-tab document (from the retired issue-desk desk view, display
// strings authored as literals).
const tasksTab = {
  id: 'tasks',
  data: {
    root: { props: {} },
    zones: {},
    content: [
      {
        type: 'Collection',
        props: {
          id: 'tasks',
          title: 'Tasks',
          query: {
            path: 'tasks/queries:listTasksByProjectPaginated',
            args: {
              projectId: '$projectId',
              organizationId: '$orgId',
              externalSystem: 'github',
            },
          },
          perPage: 50,
          filters: [
            {
              field: 'status',
              values: [
                'backlog',
                'todo',
                'in_progress',
                'in_review',
                'done',
                'cancelled',
              ],
              valueLabels: {
                backlog: 'Backlog',
                todo: 'To do',
                in_progress: 'In progress',
                in_review: 'In review',
                done: 'Done',
                cancelled: 'Cancelled',
              },
            },
          ],
          columns: [
            { field: 'title', labelKey: 'Title' },
            {
              field: 'status',
              kind: 'badge',
              labelKey: 'Status',
              valueLabels: {
                backlog: 'Backlog',
                todo: 'To do',
                in_progress: 'In progress',
                in_review: 'In review',
                done: 'Done',
                cancelled: 'Cancelled',
              },
            },
            { field: 'priority', labelKey: 'Priority' },
          ],
          subjectType: 'task',
          actions: [
            {
              labelKey: 'list.start',
              path: 'tasks/public_actions:startTaskWorkflow',
              mode: 'action',
              when: 'status == backlog || status == todo',
              args: {
                organizationId: '$orgId',
                taskId: '$selected._id',
                workflowSlug: 'issue-desk/desk-process',
              },
            },
            {
              labelKey: 'list.merge',
              path: 'tasks/public_actions:mergeTaskPullRequest',
              mode: 'action',
              variant: 'primary',
              confirm: true,
              when: 'status == in_review',
              args: {
                organizationId: '$orgId',
                taskId: '$selected._id',
              },
            },
          ],
        },
      },
    ],
  },
};

// The function allowlist the retired manifest declared for this tab.
const allowlist = [
  { path: 'tasks/queries:listTasksByProjectPaginated', mode: 'query' },
  { path: 'tasks/public_actions:startTaskWorkflow', mode: 'action' },
  { path: 'tasks/public_actions:mergeTaskPullRequest', mode: 'action' },
];

function renderTasksTab() {
  const runtime: ComponentProps<typeof AutomationRuntimeProvider>['value'] = {
    organizationId: 'org-1',
    projectId: 'proj-1',
    automationSlug: 'issue-desk',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture matches FunctionBinding
    allowlist: allowlist as ComponentProps<
      typeof AutomationRuntimeProvider
    >['value']['allowlist'],
    config: {},
  };
  return render(
    <AutomationRuntimeProvider value={runtime}>
      <AutomationView data={tasksTab.data} />
    </AutomationRuntimeProvider>,
  );
}

beforeEach(() => {
  paginatedError = undefined;
  lastPaginatedArgs = undefined;
});

describe('issue-desk Tasks tab through the registry (shipped bundle props)', () => {
  it('renders the first-page loading state', () => {
    paginatedState = {
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
      loadMore: vi.fn(),
    };
    renderTasksTab();
    expect(screen.getByText('Tasks')).toBeVisible();
    // The bound query fired with the fully resolved runtime args.
    expect(lastPaginatedArgs).toEqual({
      projectId: 'proj-1',
      organizationId: 'org-1',
      externalSystem: 'github',
    });
  });

  it('renders the empty state with the title and status filter', () => {
    paginatedState = {
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore: vi.fn(),
    };
    renderTasksTab();
    expect(screen.getByText('Tasks')).toBeVisible();
    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });

  it('renders loaded rows with literal badge labels and when-gated actions', () => {
    paginatedState = {
      results: [
        {
          _id: 'task-1',
          title: 'Fix the login bug',
          status: 'todo',
          priority: 'high',
          projectId: 'proj-1',
          organizationId: 'org-1',
        },
      ],
      status: 'Exhausted',
      isLoading: false,
      loadMore: vi.fn(),
    };
    renderTasksTab();
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
    // Badge value label rendered from the literal valueLabels map.
    expect(screen.getByText('To do')).toBeVisible();
    // `when: status == backlog || status == todo` → Start shows, Merge hides.
    expect(
      screen.getByRole('button', { name: 'automations.list.start' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'automations.list.merge' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the block frame (title) when the paginated read rethrows a server error', () => {
    paginatedState = {
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
      loadMore: vi.fn(),
    };
    paginatedError = new Error('Unauthenticated');
    // The boundary logs the crash; keep the test output clean and assert it.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    renderTasksTab();

    // Contained: the compact error renders INSIDE the block's frame — the
    // title survives instead of the whole card becoming an anonymous panel.
    expect(
      screen.getByText('common.errors.somethingWentWrong'),
    ).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      '[automation-registry] block "Collection" crashed',
      paginatedError,
    );
    consoleError.mockRestore();
  });
});
