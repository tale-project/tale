// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// ---------------------------------------------------------------------------
// The project shell shows an Automations tab only when something is bound to
// THAT project. Tasks stay the day-to-day automation interface, so a project
// with nothing bound must not carry a tab that opens an empty list — and once
// something IS bound the operator needs a way in that is not a detour through
// the org Automations page.
// ---------------------------------------------------------------------------

const {
  mockUseAutomations,
  mockUseProject,
  mockLocation,
  mockNavigate,
  mockClearNavSection,
} = vi.hoisted(() => ({
  mockUseAutomations: vi.fn(),
  mockUseProject: vi.fn(),
  mockLocation: {
    pathname: '/dashboard/org-1/projects/proj-1',
    search: {} as Record<string, unknown>,
    // The real ParsedHistoryState is always an object; the rail sets
    // `navRestore` on it when it reopened a REMEMBERED project.
    state: {} as Record<string, unknown>,
  },
  mockNavigate: vi.fn(),
  mockClearNavSection: vi.fn(),
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

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

vi.mock('@/app/features/automations/hooks/queries', () => ({
  useAutomations: mockUseAutomations,
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: mockUseProject,
}));

vi.mock('@/app/lib/nav-memory', () => ({
  clearNavSection: mockClearNavSection,
}));

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
vi.mock('@/app/components/layout/page-layout', () => ({
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

vi.mock('@/app/components/layout/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/app/components/layout/header-breadcrumbs', () => ({
  HEADER_CRUMB_LINK_CLASS: '',
  HeaderBreadcrumbs: ({ leaf }: { leaf?: React.ReactNode }) => (
    <div>{leaf}</div>
  ),
}));

vi.mock('@/app/components/ui/editor', () => ({
  ActiveEditorProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  EditorActions: () => null,
  useActiveEditor: () => null,
}));

// Render the tab strip as plain links so the test reads what a user would see.
// Disabled tabs render as spans (mirroring TabNavigation) so All-projects
// mode can be asserted without the real nav primitive.
vi.mock('@/app/components/ui/navigation/tab-navigation', () => ({
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
  mockLocation.pathname = '/dashboard/org-1/projects/proj-1';
  mockLocation.search = {};
  mockLocation.state = {};
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

  it('scopes the automations query to this project, not the whole org', () => {
    setup([{ name: 'sync-emails' }]);

    expect(mockUseAutomations).toHaveBeenCalledWith('org-1', 'proj-1');
  });

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
// A remembered project can be deleted between one visit and the next. The rail
// restoring the user into it must not strand them: a stale entity id is NOT a
// router 404 (it matches the route and surfaces as a data-layer null), so
// nothing else in the app catches this.
// ---------------------------------------------------------------------------
describe('project shell — a project that is gone', () => {
  function setupMissing(state: Record<string, unknown>) {
    mockUseProject.mockReturnValue({ project: undefined, isLoading: false });
    mockUseAutomations.mockReturnValue({ data: [] });
    mockLocation.state = state;
    return render(<ProjectDetailLayout />);
  }

  it('falls back to the list when the rail restored a project that is gone', () => {
    setupMissing({ navRestore: true });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects',
      params: { id: 'org-1' },
      replace: true,
    });
  });

  it('forgets the stale place so the next click does not repeat it', () => {
    setupMissing({ navRestore: true });

    expect(mockClearNavSection).toHaveBeenCalledWith('org-1', 'projects');
  });

  it('explains instead of redirecting when the user followed a shared link', () => {
    setupMissing({});

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByText('projects.errors.PROJECT_NOT_FOUND'),
    ).toBeInTheDocument();
  });

  it('offers a way back out, which the bare message never did', () => {
    setupMissing({});

    expect(
      screen.getByRole('link', { name: 'projects.title' }),
    ).toHaveAttribute('href', '/dashboard/org-1/projects');
  });
});
