// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [], isLoading: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

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

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
  useLocation: () => ({ pathname: '/dashboard/org-1/automations' }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/app/hooks/use-preload-route', () => ({
  usePreloadRoute: () => vi.fn(),
}));

vi.mock('./automation-row-actions', () => ({
  AutomationRowActions: () => <div data-testid="row-actions" />,
}));

let automationsData:
  | Array<{
      name: string;
      latest: number;
      projectIds: string[];
      deployedVersion?: number;
    }>
  | undefined;
vi.mock('../hooks/queries', () => ({
  useAutomations: () => ({
    data: automationsData,
    isPending: false,
    isError: false,
  }),
}));

import { AutomationsList } from './automations-list';

describe('AutomationsList', () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it('navigates an org-page row to the org automation route', async () => {
    automationsData = [
      { name: 'org/digest', latest: 2, projectIds: [], deployedVersion: 2 },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('org/digest'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'org__digest' },
    });
  });

  it('navigates a project-tab row into the project shell', async () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: [] },
    ];
    const { user } = render(
      <AutomationsList organizationId="org-1" projectId={'proj_1' as string} />,
    );

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('routes a single-bound org-page row into its project shell', async () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: ['proj_1'] },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('keeps a multi-bound row on the org route and shows every project chip', async () => {
    automationsData = [
      {
        name: 'desk/prepare-return',
        latest: 1,
        projectIds: ['proj_1', 'proj_2'],
      },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'desk__prepare-return' },
    });
    expect(screen.getAllByText('automations.list.projectBound')).toHaveLength(
      2,
    );
  });
});

describe('AutomationsList create menu', () => {
  it('offers the create lanes from the toolbar button when the list is empty', async () => {
    automationsData = [];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    expect(
      screen.getByText('automations.list.empty.title'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('automations.list.empty.description'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'automations.title' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('automations.list.description'),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'automations.list.createButton' }),
    );

    expect(
      screen.getByRole('menuitem', { name: 'automations.createMenu.fromGoal' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'automations.createMenu.blank' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'automations.upload.trigger' }),
    ).toBeInTheDocument();
  });

  it('keeps create in the table toolbar when rows exist', () => {
    automationsData = [
      { name: 'org/digest', latest: 1, projectIds: [], deployedVersion: 1 },
    ];
    render(<AutomationsList organizationId="org-1" />);

    expect(
      screen.queryByText('automations.list.description'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'automations.list.createButton' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('row-actions')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('automations.list.searchPlaceholder'),
    ).toBeInTheDocument();
  });
});
