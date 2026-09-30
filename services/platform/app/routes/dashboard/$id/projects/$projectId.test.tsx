// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

// ---------------------------------------------------------------------------
// The project shell shows an Automations tab only when something is bound to
// THAT project. Tasks stay the day-to-day automation interface, so a project
// with nothing bound must not carry a tab that opens an empty list — and once
// something IS bound the operator needs a way in that is not a detour through
// the org Automations page. Like the rail's entry, the tab is only ever there
// for Owners, Admins and Developers.
// ---------------------------------------------------------------------------

const { mockUseAutomations, mockUseProject, mockLocation, mockNavigate } =
  vi.hoisted(() => ({
    mockUseAutomations: vi.fn(),
    mockUseProject: vi.fn(),
    mockLocation: {
      pathname: '/dashboard/org-1/projects/proj-1',
      search: {} as Record<string, unknown>,
      state: {} as Record<string, unknown>,
    },
    mockNavigate: vi.fn(),
  }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ id: 'org-1', projectId: 'proj-1' }),
    ...config,
  }),
  Outlet: () => <div data-testid="outlet" />,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useMatch: () => undefined,
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

vi.mock('@/app/features/automations/hooks/queries', () => ({
  useAutomations: mockUseAutomations,
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: mockUseProject,
}));

// Who is looking: the real ability of that platform role. Only Owners,
// Admins and Developers may use Automations.
const viewer = { role: 'developer' };
vi.mock('@/app/hooks/use-ability', async () => {
  const { defineAbilityFor } = await import('@/lib/permissions/ability');
  return { useAbility: () => defineAbilityFor(viewer.role) };
});

vi.mock(
  '@/app/features/projects/components/project-breadcrumb-switcher',
  () => ({
    ProjectBreadcrumbSwitcher: () => <span>Apollo</span>,
    isProjectTasksPath: (pathname: string, projectId: string) =>
      pathname.includes(`/projects/${projectId}/tasks`),
  }),
);

// PageLayout / AdaptiveHeaderRoot need an AdaptiveHeaderProvider this test has
// no reason to stand up — the subject is the tab strip, not the chrome.
vi.mock('@tale/ui/page-layout', () => ({
  PageLayout: ({
    header,
    children,
  }: {
    header?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock('@tale/ui/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@tale/ui/header-breadcrumbs', () => ({
  HEADER_CRUMB_LINK_CLASS: '',
  HeaderBreadcrumbs: ({ leaf }: { leaf?: React.ReactNode }) => (
    <div>{leaf}</div>
  ),
}));

vi.mock('@tale/ui/editor', () => ({
  ActiveEditorProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  EditorActions: () => null,
  useActiveEditor: () => null,
}));

// Render the tab strip as plain links so the test reads what a user would see.
// Disabled tabs render as spans (mirroring TabNavigation) so All-projects
// mode can be asserted without the real nav primitive.
vi.mock('@/app/components/navigation/tab-navigation', () => ({
  TabNavigation: ({
    items,
  }: {
    items: Array<{ label: string; href: string; disabled?: boolean }>;
  }) => (
    <nav>
      {items.map((item) =>
        item.disabled ? (
          <span key={item.href} aria-disabled="true">
            {item.label}
          </span>
        ) : (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ),
      )}
    </nav>
  ),
}));

import { Route } from './$projectId';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
const ProjectDetailLayout = (
  Route as unknown as { component: () => React.ReactElement }
).component;

function setup(
  automations: unknown[] | undefined,
  projectOverrides: Record<string, unknown> = {},
) {
  mockUseProject.mockReturnValue({
    project: {
      _id: 'proj-1',
      name: 'Apollo',
      canAdminister: false,
      ...projectOverrides,
    },
    isLoading: false,
  });
  mockUseAutomations.mockReturnValue({ data: automations });
  return render(<ProjectDetailLayout />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  viewer.role = 'developer';
  mockLocation.pathname = '/dashboard/org-1/projects/proj-1';
  mockLocation.search = {};
  mockLocation.state = {};
  window.localStorage.clear();
});

describe('project shell — Automations tab', () => {
  it('shows the tab when the project has an automation bound', () => {
    setup([{ name: 'sync-emails' }]);

    const tab = screen.getByRole('link', { name: 'automations.title' });
    expect(tab).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations',
    );
  });

  it('hides the tab when nothing is bound, rather than opening an empty list', () => {
    setup([]);

    expect(
      screen.queryByRole('link', { name: 'automations.title' }),
    ).not.toBeInTheDocument();
  });

  it('hides the tab while the automations query is still loading', () => {
    setup(undefined);

    expect(
      screen.queryByRole('link', { name: 'automations.title' }),
    ).not.toBeInTheDocument();
  });

  it.each(['owner', 'admin'])(
    'shows the tab to the %s role, like the developer',
    (role) => {
      viewer.role = role;
      setup([{ name: 'draft-desk' }]);

      expect(
        screen.getByRole('link', { name: 'automations.title' }),
      ).toBeInTheDocument();
    },
  );

  it.each(['editor', 'member'])(
    'never shows the tab to the %s role, even for a deployed automation',
    (role) => {
      viewer.role = role;
      setup([
        { name: 'draft-desk' },
        { name: 'sync-emails', deployedVersion: 1 },
      ]);

      expect(
        screen.queryByRole('link', { name: 'automations.title' }),
      ).not.toBeInTheDocument();
    },
  );

  it('scopes the automations query to this project, not the whole org', () => {
    setup([{ name: 'sync-emails' }]);

    expect(mockUseAutomations).toHaveBeenCalledWith('org-1', 'proj-1');
  });

  it.each(['editor', 'member'])(
    'skips the automations query for the %s role, who never gets the tab',
    (role) => {
      viewer.role = role;
      setup([{ name: 'sync-emails', deployedVersion: 1 }]);

      expect(mockUseAutomations).toHaveBeenCalledWith(undefined, 'proj-1');
      expect(mockUseAutomations).not.toHaveBeenCalledWith('org-1', 'proj-1');
    },
  );

  it('keeps the tab among the project shell tabs, not replacing them', () => {
    setup([{ name: 'sync-emails' }]);

    for (const label of [
      'projects.navigation.overview',
      'projects.navigation.threads',
      'tasks.title',
      'projects.navigation.files',
      'projects.navigation.agents',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('project shell — All projects Tasks mode', () => {
  it('disables non-Tasks tabs while projects=all is active', () => {
    mockLocation.pathname = '/dashboard/org-1/projects/proj-1/tasks/board';
    mockLocation.search = { projects: 'all' };
    setup([]);

    expect(
      screen.getByRole('link', { name: 'tasks.title' }),
    ).toBeInTheDocument();
    for (const label of [
      'projects.navigation.overview',
      'projects.navigation.threads',
      'projects.navigation.files',
      'projects.navigation.agents',
    ]) {
      expect(
        screen.queryByRole('link', { name: label }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(label)).toHaveAttribute('aria-disabled', 'true');
    }
  });
});

// An archived project said so only in the Projects list. Every one of its tabs
// now carries the badge, beside the breadcrumb leaf.
describe('project shell — archived badge', () => {
  it('badges the breadcrumb when the project is archived', () => {
    setup([], { archivedAt: 1789000000000 });

    expect(screen.getByText('Apollo')).toBeInTheDocument();
    expect(screen.getByText('projects.archived.badge')).toBeInTheDocument();
  });

  it('leaves a live project unbadged', () => {
    setup([]);

    expect(screen.getByText('Apollo')).toBeInTheDocument();
    expect(
      screen.queryByText('projects.archived.badge'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A project id can be stale — a deleted project, a membership that ended. That
// is NOT a router 404 (the route matches and the read surfaces as a data-layer
// null), so nothing else in the app catches it: the shell explains it here.
// ---------------------------------------------------------------------------
describe('project shell — a project that is gone', () => {
  function setupMissing() {
    mockUseProject.mockReturnValue({ project: undefined, isLoading: false });
    mockUseAutomations.mockReturnValue({ data: [] });
    return render(<ProjectDetailLayout />);
  }

  it('explains rather than redirecting, so a shared link says what happened', () => {
    setupMissing();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByText('projects.errors.PROJECT_NOT_FOUND'),
    ).toBeInTheDocument();
  });

  it('offers a way back out, which the bare message never did', () => {
    setupMissing();

    expect(
      screen.getByRole('link', { name: 'projects.title' }),
    ).toHaveAttribute('href', '/dashboard/org-1/projects');
  });

  // A remembered project (the Home rail tile reopening it, see
  // `use-navigation-items.ts`) can be gone by the time the rail click lands —
  // deleted, or a membership change. That arrival is marked with
  // `state.navRestore`, and only THAT arrival redirects: a shared link to the
  // same dead project keeps explaining rather than bouncing away.
  it('drops the stale memory and redirects to the list on a restored arrival', () => {
    mockLocation.state = { navRestore: true };
    setupMissing();

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects',
      params: { id: 'org-1' },
      replace: true,
    });
  });
});

// A navigation AWAY updates `location.pathname` (and re-runs the write
// effect) on the render just before this component unmounts, so the pathname
// no longer belongs to THIS project. Regression for a bug where the
// unguarded effect persisted wherever the user navigated TO — e.g. clicking
// Home landed on Automations or Knowledge, because that's what the shell
// last wrote under its own key on its way out.
describe('project shell — remembering only its own path', () => {
  it('persists its own path while genuinely on it', async () => {
    const { unmount } = setup([]);
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1"'),
    );
    unmount();
  });

  it('does not overwrite the memory with a pathname that no longer belongs to this project', async () => {
    const { rerender, unmount } = setup([]);
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1"'),
    );

    // Simulate the render right before this shell unmounts on the way to
    // Automations: `pathname` has already moved, this component hasn't yet.
    mockLocation.pathname = '/dashboard/org-1/automations';
    rerender(<ProjectDetailLayout />);

    // The last GOOD path survives untouched — never Automations' path.
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1"'),
    );
    unmount();
  });

  it('remembers a project automation page for a developer', async () => {
    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-1/automations/mail-sync';
    const { unmount } = setup([{ name: 'mail-sync' }]);
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1/automations/mail-sync"'),
    );
    unmount();
  });

  // A Member who opens a project automation URL only sees the denial; if
  // Home remembered that page, the tile would keep reopening it.
  it('never remembers a project automation page for a member', async () => {
    viewer.role = 'member';
    const { rerender, unmount } = setup([{ name: 'mail-sync' }]);
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1"'),
    );

    mockLocation.pathname =
      '/dashboard/org-1/projects/proj-1/automations/mail-sync';
    rerender(<ProjectDetailLayout />);

    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
      ).toBe('"/dashboard/org-1/projects/proj-1"'),
    );
    unmount();
  });
});
