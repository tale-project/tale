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
  useDeleteProject: () => ({ mutateAsync: vi.fn() }),
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

  it('exposes the description on hover without adding a second line', () => {
    renderTable([
      row({ name: 'Acme onboarding', description: 'Enterprise rollout' }),
    ]);

    expect(screen.getByText('Acme onboarding')).toHaveAttribute(
      'title',
      'Enterprise rollout',
    );
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
