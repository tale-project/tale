// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ACTIONS_COLUMN_SIZE,
  SELECT_COLUMN_SIZE,
} from '@tale/ui/data-table/column-builders';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
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

const overview = vi.hoisted(() => ({
  projects: [] as unknown[],
  overdueTruncated: false,
  isLoading: false,
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
  name?: string;
  key?: string;
  description?: string;
  openTaskCount?: number;
  doneTaskCount?: number;
  overdueTaskCount?: number;
  projectAgentCount?: number;
  teamIds?: string[];
}

function row(overrides: RowOverrides = {}) {
  return {
    _id: 'project_1',
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
    updatedAt: Date.now(),
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

function renderTable(
  rows: ReturnType<typeof row>[],
  flags: { overdueTruncated?: boolean } = {},
) {
  overview.projects = rows;
  overview.overdueTruncated = flags.overdueTruncated ?? false;
  overview.isLoading = false;
  return render(<ProjectsTable organizationId="test-org-id" />);
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
    const two = renderTable([row({ teamIds: ['team_1', 'team_2'] })]);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(
      screen.queryByText('projects.list.sharingMoreTeams'),
    ).not.toBeInTheDocument();
    two.unmount();

    // Beyond two, the rest folds into a count; the full list stays in the
    // title and the screen-reader text.
    renderTable([row({ teamIds: ['team_1', 'team_2', 'team_3'] })]);
    expect(
      screen.getByText('projects.list.sharingMoreTeams'),
    ).toBeInTheDocument();
    expect(screen.getByTitle('Engineering, Design, Sales')).toBeInTheDocument();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
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

  it('renders the fixed frame every overview list uses', () => {
    // Projects, Automations and the Knowledge tables are all the same shape:
    // the table owns a scrollport so the toolbar, the header row and the
    // count footer stay put. Without it the page shell scrolls instead and
    // this list drifts away from the other two.
    renderTable([row({ name: 'Acme onboarding' })]);

    expect(screen.getByTestId('data-table-scrollport')).toBeInTheDocument();
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
