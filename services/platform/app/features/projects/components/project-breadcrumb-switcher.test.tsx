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
let pageIsDone = true;
/** What the server's name search adds once something is typed (#5194). */
let searchHits: ProjectRow[] = [];
let projectsError = false;
const retryProjects = vi.fn();
const projectChoices = vi.fn((_organizationId: string, query: string) => ({
  projects:
    query === '' ? projectsFixture : [...projectsFixture, ...searchHits],
  isDone: pageIsDone,
  isLoading: false,
  error: projectsError,
  isRetrying: false,
  retry: retryProjects,
}));

vi.mock('../hooks/queries', () => ({
  useProjectChoices: (organizationId: string, query: string) =>
    projectChoices(organizationId, query),
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
    projectsError = false;
    retryProjects.mockReset();
    projectsFixture = [
      { _id: CURRENT_ID, name: 'Getting started' },
      { _id: OTHER_ID, name: 'Acme AG' },
    ];
    pageIsDone = true;
    searchHits = [];
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

  it("leaves the current project's upload folder behind (#3918)", async () => {
    mockLocation.search = { folderId: 'folder-a' };
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

    const call = mockNavigate.mock.calls[0]?.[0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/dashboard/org-1/projects/proj-acme/files');
    expect(call.search({ folderId: 'folder-a' })).toEqual({});
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

  // #5194: the menu reads one page of projects, never all of them; a project
  // past it is found by the server's name search and picked like any other.
  it('finds a project past the page by its name and switches to it', async () => {
    projectsFixture = [
      { _id: CURRENT_ID, name: 'Getting started' },
      ...Array.from({ length: 99 }, (_, index) => ({
        _id: `proj-${index + 1}`,
        name: `Project ${index + 1}`,
      })),
    ];
    pageIsDone = false;
    searchHits = [{ _id: 'proj-101', name: 'Project 101' }];
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
      screen.queryByRole('option', { name: 'Project 101' }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'Project 101');

    expect(projectChoices).toHaveBeenCalledWith('org-1', 'Project 101');
    await user.click(screen.getByRole('option', { name: 'Project 101' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/dashboard/org-1/projects/proj-101/files',
      }),
    );
  });

  it('offers the current project when it lies past the page', async () => {
    projectsFixture = [{ _id: OTHER_ID, name: 'Acme AG' }];
    pageIsDone = false;
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
    const current = screen.getByRole('option', { name: 'Getting started' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Acme AG' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    await user.click(current);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('offers no archived current project once the page holds every project', async () => {
    projectsFixture = [{ _id: OTHER_ID, name: 'Acme AG' }];
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
    expect(screen.getByRole('option', { name: 'Acme AG' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Getting started' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the current name and offers a retry when the project list fails', () => {
    projectsError = true;
    render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Project list unavailable',
    );
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(retryProjects).toHaveBeenCalledOnce();
  });

  it('recovers the switcher after a successful retry', () => {
    projectsError = true;
    const view = render(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );
    projectsError = false;
    view.rerender(
      <ProjectBreadcrumbSwitcher
        organizationId="org-1"
        projectId={CURRENT_ID}
        projectName="Getting started"
      />,
    );
    expect(
      screen.getByRole('button', { name: /switch project/i }),
    ).toBeInTheDocument();
  });

  it('renders a plain name when the project list is empty', () => {
    projectsError = false;
    retryProjects.mockReset();
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
