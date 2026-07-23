import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProjectBreadcrumbSwitcher } from './project-breadcrumb-switcher';

const mockNavigate = vi.fn();
const mockLocation = {
  pathname: '/dashboard/org-1/projects/proj-getting-started/files',
  search: {} as Record<string, unknown>,
};

type ProjectRow = {
  _id: Id<'projects'>;
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

const CURRENT_ID = 'proj-getting-started' as Id<'projects'>;
const OTHER_ID = 'proj-acme' as Id<'projects'>;

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

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/projects/proj-acme/files',
      search: {},
    });
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
