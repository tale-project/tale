// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
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

import { ProjectsTable } from './projects-table';

interface RowOverrides {
  name?: string;
  key?: string;
  description?: string;
  openTaskCount?: number;
  doneTaskCount?: number;
  overdueTaskCount?: number;
  projectAgentCount?: number;
  teamId?: string;
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
    teamId: overrides.teamId,
    sharedWithTeamIds: undefined,
    createdBy: 'user_1',
    createdAt: 0,
    updatedAt: Date.now(),
    archivedAt: undefined,
    isOrgWide: overrides.teamId === undefined,
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
    // Name is the implicit flex column; Tasks/Activity use size ratios —
    // 152 and 110 of 240+152+92+80+88+110 = 762. No meta.flex on Tasks
    // (that packed Overdue…Activity against the right edge).
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
    expect(tasksHeader.style.width).toContain('0.1995');
    expect(activityHeader.style.width).toContain('0.1444');
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

  it('distinguishes org-wide from team-scoped sharing without spending a text column', () => {
    const { unmount } = renderTable([row()]);
    expect(
      screen.getByText('projects.list.sharingOrgWide'),
    ).toBeInTheDocument();
    unmount();

    renderTable([row({ teamId: 'team_1' })]);
    expect(
      screen.getByText('projects.list.sharingMultipleTeams'),
    ).toBeInTheDocument();
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
