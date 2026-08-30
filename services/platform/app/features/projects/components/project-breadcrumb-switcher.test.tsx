import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProjectBreadcrumbSwitcher } from './project-breadcrumb-switcher';

const mockNavigate = vi.fn();
const mockLocation = {
  pathname: '/dashboard/org-1/projects/proj-getting-started/files',
  search: {} as Record<string, unknown>,
};

type ProjectRow = {
  _id: string;
  name: string;
};

let projectsFixture: ProjectRow[] = [];

vi.mock('../hooks/queries', () => ({
  useProjects: () => ({ projects: projectsFixture, isLoading: false }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

const CURRENT_ID = 'proj-getting-started' as string;
const OTHER_ID = 'proj-acme' as string;

describe('ProjectBreadcrumbSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-getting-started/files';
    mockLocation.search = {};
    projectsFixture = [
      { _id: CURRENT_ID, name: 'Getting started' },
      { _id: OTHER_ID, name: 'Acme AG' },
    ];
  });

  it('opens a menu of sibling projects from the current name', async () => {
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );

    expect(
      screen.getByRole('option', { name: 'Getting started' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Acme AG' })).toBeInTheDocument();
  });

  it('navigates to the selected project while keeping the current sub-page', async () => {
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Acme AG' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/dashboard/org-1/projects/proj-acme/files',
      }),
    );
    const call = mockNavigate.mock.calls[0]?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ projects: 'all' })).toEqual({});
  });

  it('does not navigate when the current project is chosen again', async () => {
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Getting started' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders a plain name when the project list is empty', () => {
    projectsFixture = [];
    render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    expect(
      screen.queryByRole('button', { name: /switch project/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Getting started')).toBeInTheDocument();
  });

  it('offers All projects on a Tasks path and sets projects=all', async () => {
    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-getting-started/tasks/board';
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );
    expect(
      screen.getByRole('option', { name: /all projects/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /all projects/i }));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/dashboard/org-1/projects/proj-getting-started/tasks/board',
      }),
    );
    const call = mockNavigate.mock.calls[0]?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({})).toEqual({ projects: 'all' });
  });

  it('does not offer All projects off the Tasks path', async () => {
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );
    expect(
      screen.queryByRole('option', { name: 'All projects' }),
    ).not.toBeInTheDocument();
  });

  it('shows All projects as the leaf when projects=all is active', async () => {
    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-getting-started/tasks/board';
    mockLocation.search = { projects: 'all' };
    render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    expect(
      screen.getByRole('button', {
        name: /switch project, current: all projects/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('All projects')).toBeInTheDocument();
  });

  it('clears projects=all when picking a concrete project', async () => {
    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-getting-started/tasks/board';
    mockLocation.search = { projects: 'all' };
    const { user } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: all projects/i,
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Acme AG' }));

    const call = mockNavigate.mock.calls[0]?.[0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/dashboard/org-1/projects/proj-acme/tasks/board');
    expect(call.search({ projects: 'all', task: 't1' })).toEqual({
      task: 't1',
    });
  });

  it('passes an axe audit with the menu open', async () => {
    const { user, container } = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: /switch project, current: getting started/i,
      }),
    );
    await checkAccessibility(container);
  });
});
