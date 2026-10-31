// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ACTIONS_COLUMN_SIZE,
  SELECT_COLUMN_SIZE,
} from '@tale/ui/data-table/column-builders';
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
  // Resolves `$param` segments from `params` the way the router would, so a
  // test can read the row link's real destination off `href`.
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
    <a
      href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? key)}
      {...rest}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/dashboard/test-org/projects' }),
}));

vi.mock('@/app/hooks/use-preload-route', () => ({
  usePreloadRoute: () => vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useArchiveProject: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./project-row-actions', () => ({
  ProjectRowActions: () => <div data-testid="row-actions" />,
}));

vi.mock('./project-create-dialog', () => ({
  ProjectCreateDialog: () => null,
}));

// The listing as `useProjectsOverview` hands it over: the loaded pages'
// rows, how far the walk got, and the way to the next page.
const overview = vi.hoisted(() => ({
  projects: [] as unknown[],
  results: [] as unknown[],
  status: 'Exhausted' as
    | 'LoadingFirstPage'
    | 'CanLoadMore'
    | 'LoadingMore'
    | 'Exhausted',
  loadMore: vi.fn<(numItems: number) => void>(),
  isLoading: false,
  error: null as Error | null,
  retry: () => undefined,
  isRetrying: false,
  unavailable: false,
  errorCount: 0,
}));

vi.mock('../hooks/queries', () => ({
  useProjectsOverview: () => overview,
}));

// The audience column and the Teams filter read the org's team DIRECTORY
// (every team's id and name, for any member) and the viewer's own teams.
const DIRECTORY = [
  { id: 'team_1', name: 'Engineering' },
  { id: 'team_2', name: 'Design' },
  { id: 'team_3', name: 'Sales' },
];
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeamNames: () => ({
    nameOf: (teamId: string) =>
      DIRECTORY.find((team) => team.id === teamId)?.name,
    isLoading: false,
    teams: DIRECTORY,
  }),
  useTeams: () => ({
    teams: [
      { id: 'team_1', name: 'Engineering', memberCount: 1, createdAt: 0 },
    ],
    isLoading: false,
  }),
}));

import { ProjectsTable } from './projects-table';

interface RowOverrides {
  id?: string;
  name?: string;
  key?: string;
  description?: string;
  openTaskCount?: number;
  doneTaskCount?: number;
  overdueTaskCount?: number;
  projectAgentCount?: number;
  teamIds?: string[];
  updatedAt?: number;
}

function row(overrides: RowOverrides = {}) {
  return {
    _id: overrides.id ?? 'project_1',
    _creationTime: 0,
    organizationId: 'test-org-id',
    name: overrides.name ?? 'Acme onboarding',
    description: overrides.description,
    key: overrides.key,
    icon: undefined,
    color: undefined,
    teamIds: overrides.teamIds ?? [],
    createdBy: 'user_1',
    createdAt: 0,
    updatedAt: overrides.updatedAt ?? Date.now(),
    archivedAt: undefined,
    isOrgWide: (overrides.teamIds ?? []).length === 0,
    canEdit: true,
    canAdminister: true,
    openTaskCount: overrides.openTaskCount ?? 0,
    doneTaskCount: overrides.doneTaskCount ?? 0,
    overdueTaskCount: overrides.overdueTaskCount ?? 0,
    projectAgentCount: overrides.projectAgentCount ?? 0,
  };
}

const ABILITIES = {
  editor: defineAbilityFor('editor'),
  member: defineAbilityFor('member'),
};

type PageStatus = (typeof overview)['status'];

/** The loaded pages, as the listing holds them after a page lands. */
function setPages(rows: ReturnType<typeof row>[], status: PageStatus) {
  overview.projects = rows;
  overview.results = rows;
  overview.status = status;
}

function tableTree(
  flags: { role?: 'editor' | 'member'; teamFilter?: string[] } = {},
) {
  return (
    <AbilityContext.Provider value={ABILITIES[flags.role ?? 'editor']}>
      <ProjectsTable
        organizationId="test-org-id"
        {...(flags.teamFilter !== undefined
          ? { teamFilter: flags.teamFilter, onTeamFilterChange: vi.fn() }
          : {})}
      />
    </AbilityContext.Provider>
  );
}

function renderTable(
  rows: ReturnType<typeof row>[],
  flags: {
    role?: 'editor' | 'member';
    status?: PageStatus;
    teamFilter?: string[];
  } = {},
) {
  setPages(rows, flags.status ?? 'Exhausted');
  overview.loadMore = vi.fn();
  overview.isLoading = false;
  return render(tableTree(flags));
}

describe('ProjectsTable', () => {
  it('renders the project identity chip and key', () => {
    renderTable([row({ name: 'Acme onboarding', key: 'TAL' })]);

    // ProjectAvatar carries the accessible name itself.
    expect(
      screen.getByRole('img', { name: 'Acme onboarding' }),
    ).toBeInTheDocument();
    expect(screen.getByText('TAL')).toBeInTheDocument();
  });

  it('exposes name + description on hover without adding a second line', () => {
    renderTable([
      row({ name: 'Acme onboarding', description: 'Enterprise rollout' }),
    ]);

    expect(screen.getByText('Acme onboarding')).toHaveAttribute(
      'title',
      'Acme onboarding — Enterprise rollout',
    );
  });

  it('shares width proportionally so metadata columns are not clustered', () => {
    // Name is the implicit flex column; Tasks/Activity get their declared
    // size as a plain percentage of the table's floor — the content sizes
    // 240+152+92+80+160+136 = 860 (Audience is wide enough for two team
    // names) plus the pinned select + actions px — so the floor resolves to
    // exactly the declared px and a wider table scales every column up. No
    // meta.flex on Tasks (that packed Overdue…Activity against the right
    // edge).
    const floorPx = 860 + SELECT_COLUMN_SIZE + ACTIONS_COLUMN_SIZE;
    const share = (size: number) => `${((size / floorPx) * 100).toFixed(4)}%`;
    renderTable([row({ name: 'Acme onboarding' })]);

    const nameHeader = screen.getByRole('columnheader', {
      name: 'projects.list.columnName',
    });
    const tasksHeader = screen.getByRole('columnheader', {
      name: 'projects.list.columnTasks',
    });
    const activityHeader = screen.getByRole('columnheader', {
      name: 'projects.list.columnActivity',
    });
    expect(nameHeader.style.width).toBe('');
    expect(tasksHeader.style.width).toBe(share(152));
    expect(activityHeader.style.width).toBe(share(136));
  });

  it('hides low-priority columns on small screens so Name stays readable', () => {
    // Agents/sharing/activity progressive-disclose; Overdue stays (compact).
    renderTable([row({ name: 'Getting started' })]);

    expect(
      screen.getByRole('columnheader', { name: 'projects.list.columnAgents' }),
    ).toHaveClass('hidden', 'md:table-cell');
    expect(
      screen.getByRole('columnheader', { name: 'projects.list.columnSharing' }),
    ).toHaveClass('hidden', 'md:table-cell');
    expect(
      screen.getByRole('columnheader', {
        name: 'projects.list.columnActivity',
      }),
    ).toHaveClass('hidden', 'lg:table-cell');
  });

  it('renders task progress out of open + done', () => {
    renderTable([row({ openTaskCount: 7, doneTaskCount: 24 })]);

    // 24 done of 31 total — cancelled work is in neither counter, so it never
    // reaches the denominator.
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '24');
    expect(bar).toHaveAttribute('aria-valuemax', '31');
    expect(bar).toHaveAccessibleName('projects.list.taskProgressA11y');
  });

  it('reads as empty rather than 0/0 when a project has no tasks', () => {
    renderTable([row({ openTaskCount: 0, doneTaskCount: 0 })]);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('projects.list.noTasks')).toBeInTheDocument();
  });

  it('shows an overdue badge only when something is overdue', () => {
    const { unmount } = renderTable([row({ overdueTaskCount: 2 })]);
    expect(screen.getByText('projects.list.overdueA11y')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    unmount();

    renderTable([row({ overdueTaskCount: 0 })]);
    expect(
      screen.queryByText('projects.list.overdueA11y'),
    ).not.toBeInTheDocument();
  });

  it('renders the agent count with an accessible label', () => {
    renderTable([row({ projectAgentCount: 2 })]);

    expect(screen.getByText('projects.list.agentsA11y')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('reads as empty rather than 0 when a project has no agents', () => {
    renderTable([row({ projectAgentCount: 0 })]);

    expect(
      screen.queryByText('projects.list.agentsA11y'),
    ).not.toBeInTheDocument();
  });

  it('names the audience: organization-wide, the teams by name, and how many more', () => {
    const { unmount } = renderTable([row()]);
    expect(
      screen.getByText('projects.list.sharingOrgWide'),
    ).toBeInTheDocument();
    unmount();

    // The names come from the directory, so a team the viewer is NOT in
    // (Design) still reads as itself instead of a raw id.
    const one = renderTable([row({ teamIds: ['team_2'] })]);
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(
      screen.queryByText('projects.list.sharingMoreTeams'),
    ).not.toBeInTheDocument();
    one.unmount();

    // Past the first, the rest folds into a count; the full list stays in the
    // title and the folded names in the screen-reader text.
    renderTable([row({ teamIds: ['team_1', 'team_2', 'team_3'] })]);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(
      screen.getByText('projects.list.sharingMoreTeams'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTitle('Engineering, Design, Sales').length,
    ).toBeGreaterThan(0);
    // Design and Sales lost their chip but not their reader: they are the
    // screen-reader-only twin of the `+2`, which is itself hidden from the
    // accessibility tree.
    expect(screen.getByText('Design, Sales')).toHaveClass('sr-only');
  });

  it('labels a team the directory no longer knows instead of showing its id', () => {
    renderTable([row({ teamIds: ['team_gone'] })]);
    // The chip and its screen-reader twin both carry the label; the id
    // appears nowhere.
    expect(
      screen.getAllByText('projects.list.unknownTeam').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('team_gone')).not.toBeInTheDocument();
  });

  it('offers bulk archive, not bulk delete', async () => {
    // Selection is for reversible archive only. Delete stays on the per-row
    // ProjectDeleteDialog (cascade + confirm phrase).
    const { user } = renderTable([
      row({ name: 'Acme onboarding', key: 'TAL' }),
    ]);

    // One administerable, unarchived row => the header select-all plus a
    // single row checkbox.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    const [, rowCheckbox] = checkboxes;
    await user.click(rowCheckbox);

    expect(
      screen.getByRole('button', { name: 'common.actions.archiveSelected' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'common.actions.deleteSelected' }),
    ).not.toBeInTheDocument();
  });

  it('offers exactly one create affordance, in the table toolbar', () => {
    renderTable([]);

    // The empty state carries copy only — the toolbar `addAction` is the one
    // create button, the same shape every other list page uses.
    expect(screen.getByText('projects.list.emptyTitle')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'projects.list.createButton' }),
    ).toHaveLength(1);
  });

  it('offers a Member no create button and says how projects reach them', () => {
    // The server refuses a project create below the Editor role.
    renderTable([], { role: 'member' });

    expect(
      screen.queryByRole('button', { name: 'projects.list.createButton' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('projects.list.emptyReaderDescription'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('projects.list.emptyDescription'),
    ).not.toBeInTheDocument();
  });

  it('renders the fixed frame every overview list uses', () => {
    // Projects, Automations and the Knowledge tables are all the same shape:
    // the table owns a scrollport so the toolbar, the header row and the
    // count footer stay put. Without it the page shell scrolls instead and
    // this list drifts away from the other two.
    renderTable([row({ name: 'Acme onboarding' })]);

    expect(screen.getByTestId('data-table-scrollport')).toBeInTheDocument();
  });

  // A row used to open on pointer click alone (`onRowClick` on the <tr>):
  // its only focusable descendants were Select row and Open menu, so a
  // keyboard or screen-reader user could not open a project from the list.
  it('makes the project name a link a keyboard user can open', async () => {
    const { user } = renderTable([
      row({ name: 'Acme onboarding', key: 'TAL' }),
    ]);
    const link = screen.getByRole('link', { name: 'Acme onboarding' });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/test-org-id/projects/project_1/tasks',
    );
    // Tab reaches it (after the toolbar and the row's Select checkbox).
    for (let i = 0; i < 20 && document.activeElement !== link; i++) {
      await user.tab();
    }
    expect(link).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderTable([
      row({
        name: 'Acme onboarding',
        key: 'TAL',
        openTaskCount: 7,
        doneTaskCount: 24,
        overdueTaskCount: 2,
        projectAgentCount: 2,
      }),
    ]);

    await checkAccessibility(container);
  });
});

// The list reads one page of projects at a time (#5156): the next page
// comes as the reader scrolls, and whatever narrows the rows on the client —
// the search and the Teams filter — reads every page first, so a project past
// the first page is never "no match".
describe('ProjectsTable — pages', () => {
  /** The sentinels the table watches, so a test can scroll one into view. */
  const watched: { callback: IntersectionObserverCallback; target: Element }[] =
    [];

  class RecordingObserver {
    readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      watched.push({ callback: this.callback, target });
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  function scrollToEnd() {
    const sentinel = watched.at(-1);
    expect(sentinel).toBeDefined();
    act(() => {
      sentinel?.callback(
        [
          {
            isIntersecting: true,
            target: sentinel.target,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  }

  afterEach(() => {
    watched.length = 0;
    vi.unstubAllGlobals();
  });

  it('loads the next page as the reader scrolls, and lists its projects once it lands', () => {
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    const newest = row({ id: 'project_2', name: 'Newest project' });
    const view = renderTable([newest], { status: 'CanLoadMore' });

    // One page, and no more until the reader asks for it.
    expect(screen.getByRole('link', { name: 'Newest project' })).toBeVisible();
    expect(overview.loadMore).not.toHaveBeenCalled();

    scrollToEnd();
    expect(overview.loadMore).toHaveBeenCalledTimes(1);

    setPages(
      [newest, row({ id: 'project_1', name: 'Older project' })],
      'Exhausted',
    );
    view.rerender(tableTree());
    expect(screen.getByRole('link', { name: 'Newest project' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Older project' })).toBeVisible();
  });

  it('reads every page while the Teams filter is on, and finds a project past the first', () => {
    const orgWide = row({ id: 'project_2', name: 'Org-wide project' });
    const view = renderTable([orgWide], {
      status: 'CanLoadMore',
      teamFilter: ['team_1'],
    });

    // Nothing on the first page is the team's, and the next page is asked
    // for without a scroll.
    expect(
      screen.queryByRole('link', { name: 'Engineering project' }),
    ).not.toBeInTheDocument();
    expect(overview.loadMore).toHaveBeenCalledWith(200);

    setPages(
      [
        orgWide,
        row({
          id: 'project_1',
          name: 'Engineering project',
          teamIds: ['team_1'],
        }),
      ],
      'Exhausted',
    );
    view.rerender(tableTree({ teamFilter: ['team_1'] }));
    expect(
      screen.getByRole('link', { name: 'Engineering project' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Org-wide project' }),
    ).not.toBeInTheDocument();
  });

  it('reads one page at a time while nothing narrows the list', () => {
    renderTable([row()], { status: 'CanLoadMore', teamFilter: [] });

    expect(overview.loadMore).not.toHaveBeenCalled();
  });

  it('reads every page while a search is typed, so it matches the whole list', async () => {
    const { user } = renderTable([row({ name: 'Acme onboarding' })], {
      status: 'CanLoadMore',
    });
    expect(overview.loadMore).not.toHaveBeenCalled();

    await user.type(
      screen.getByPlaceholderText('projects.list.searchPlaceholder'),
      'TAL',
    );

    await waitFor(() => expect(overview.loadMore).toHaveBeenCalled());
  });

  it('keeps the loaded projects when a later page fails, and names the failure above them', () => {
    overview.error = new Error('page 2 failed');
    overview.errorCount = 1;
    try {
      renderTable([row({ name: 'Acme onboarding' })], {
        status: 'CanLoadMore',
      });

      expect(
        screen.getByRole('link', { name: 'Acme onboarding' }),
      ).toBeVisible();
      expect(
        screen.getByText('projects.list.refreshFailed'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: 'projects.title' }),
      ).toBeInTheDocument();
    } finally {
      overview.error = null;
      overview.errorCount = 0;
    }
  });
});

// #4892 (addendum): Last activity was worded in the browser's language
// (`navigator.language`), not the app's, and never went past days.
describe('ProjectsTable — Last activity', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  afterEach(() => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it("reads in the app's language, not the browser's", async () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');

    renderTable([row({ updatedAt: Date.now() - 3 * DAY_MS })]);

    expect(await screen.findByText('vor 3 Tagen')).toBeInTheDocument();
    expect(screen.queryByText('3 days ago')).not.toBeInTheDocument();
  });

  it('reads an old project in months or years, never hundreds of days', async () => {
    renderTable([row({ updatedAt: Date.now() - 400 * DAY_MS })]);

    expect(await screen.findByText('a year ago')).toBeInTheDocument();
    expect(screen.queryByText('400 days ago')).not.toBeInTheDocument();
  });
});

describe('ProjectsTable — a failed overview read', () => {
  // The org has projects; the read failed. "No projects yet" here read as
  // data loss (2026-09-26 evaluation, G-07).
  it('shows the error state with a retry, never the first-run empty state', () => {
    setPages([], 'Exhausted');
    overview.error = new Error('overview failed');
    try {
      render(<ProjectsTable organizationId="test-org-id" />);
      expect(
        screen.getByRole('button', { name: /tryAgain|try ?again/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/projects\.list\.empty/)).toBeNull();
    } finally {
      overview.error = null;
    }
  });
});
