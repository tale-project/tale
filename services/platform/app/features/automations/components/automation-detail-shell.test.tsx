// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationDetailShell } from './automation-detail-shell';

/**
 * The shell is the automation twin of the project detail layout: breadcrumb
 * row, then a tab strip — Editor, General, Versions, Runs — whose trailing
 * slot the open tab fills. These tests pin the strip's shape and where its tabs lead on
 * both route families, and the not-found state that keeps the trail.
 */

const fixtures = vi.hoisted(() => ({
  automation: { name: 'billing/dunning', deployedVersion: 2 } as unknown,
  isPending: false,
  error: undefined as unknown,
  dirtyKeys: undefined as ReadonlySet<string> | undefined,
  pathname: '/dashboard/org-1/automations/sync-emails',
  state: {} as Record<string, unknown>,
}));

const mockNavigate = vi.hoisted(() => vi.fn());

// The shell reads the location to tell a RESTORED arrival (the rail reopening
// a remembered automation) from a deliberate one, so a deleted automation falls
// back to the list instead of dead-ending. No router is mounted here.
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    pathname: fixtures.pathname,
    search: {},
    state: fixtures.state,
  }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationVersions: () => ({ data: [], isPending: false }),
  useAutomation: () => ({
    data: fixtures.automation,
    isPending: fixtures.isPending,
    isError: fixtures.error !== undefined,
    error: fixtures.error,
  }),
}));

// The trail has its own tests; here it only needs to be the page heading.
vi.mock('./automation-breadcrumbs', () => ({
  AutomationBreadcrumbs: ({ projectId }: { projectId?: string }) => (
    <h1>{projectId === undefined ? 'Automations / Dunning' : 'Project run'}</h1>
  ),
}));

vi.mock('@tale/ui/page-layout', () => ({
  PageLayout: ({
    header,
    children,
  }: {
    header?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock('@tale/ui/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({
    children,
    showBorder,
  }: {
    children: ReactNode;
    showBorder?: boolean;
  }) => (
    <div data-testid="title-row" data-border={showBorder ? 'own' : 'none'}>
      {children}
    </div>
  ),
  AdaptiveHeaderTabActionsSlot: () => <div data-testid="tab-actions-slot" />,
}));

vi.mock('@tale/ui/editor', () => ({
  ActiveEditorProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useActiveEditor: () =>
    fixtures.dirtyKeys === undefined ? null : { dirtyKeys: fixtures.dirtyKeys },
}));

// Render the strip as plain links so the test reads what a user would see,
// keeping the trailing children (the actions slot) where the strip puts them.
vi.mock('@/app/components/navigation/tab-navigation', () => ({
  TabNavigation: ({
    items,
    ariaLabel,
    children,
    trailing,
    dirtyKeys,
  }: {
    items: Array<{
      label: string;
      href: string;
      matchMode?: string;
      dirtyKeys?: readonly string[];
      disabled?: boolean;
    }>;
    ariaLabel?: string;
    children?: ReactNode;
    trailing?: ReactNode;
    dirtyKeys?: ReadonlySet<string>;
  }) => (
    <nav aria-label={ariaLabel}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          data-match={item.matchMode}
          data-disabled={item.disabled ? 'true' : 'false'}
          data-dirty={
            item.dirtyKeys?.some((key) => dirtyKeys?.has(key))
              ? 'true'
              : 'false'
          }
        >
          {item.label}
        </a>
      ))}
      {children}
      {trailing}
    </nav>
  ),
}));

function renderShell(props: { projectId?: string } = {}) {
  return render(
    <AutomationDetailShell
      organizationId="org-1"
      automationSlug="billing/dunning"
      {...props}
    >
      <div data-testid="outlet">tab page</div>
    </AutomationDetailShell>,
  );
}

beforeEach(() => {
  fixtures.automation = { name: 'billing/dunning', deployedVersion: 2 };
  fixtures.isPending = false;
  fixtures.error = undefined;
  fixtures.dirtyKeys = undefined;
  fixtures.pathname = '/dashboard/org-1/automations/sync-emails';
  fixtures.state = {};
  mockNavigate.mockClear();
  window.localStorage.clear();
});

describe('AutomationDetailShell', () => {
  it('carries the Editor, General and Runs tabs on the org route', () => {
    renderShell();
    const strip = screen.getByRole('navigation', {
      name: 'Automations navigation',
    });
    // General sits right of Editor: the workbench first, then the
    // automation's own settings.
    expect(
      within(strip)
        .getAllByRole('link')
        .map((tab) => tab.textContent),
    ).toEqual(['Editor', 'General', 'Runs']);
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/editor',
    );
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/general',
    );
    expect(screen.queryByRole('link', { name: 'Versions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/runs',
    );
    // A run's own page is a sub-view of Runs; the other tabs match exactly.
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'data-match',
      'startsWith',
    );
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
      'data-match',
      'exact',
    );
    expect(strip).toContainElement(screen.getByTestId('tab-actions-slot'));
    expect(screen.getByTestId('outlet')).toBeVisible();
  });

  it('keeps every tab inside the project shell on the project route', () => {
    renderShell({ projectId: 'proj-1' });
    for (const [label, tab] of [
      ['Editor', 'editor'],
      ['General', 'general'],
      ['Runs', 'runs'],
    ] as const) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/dashboard/org-1/projects/proj-1/automations/billing__dunning/${tab}`,
      );
    }
  });

  it('leaves the divider to the tab strip under the title row', () => {
    renderShell();
    expect(screen.getByTestId('title-row')).toHaveAttribute(
      'data-border',
      'none',
    );
  });

  it("lights the Editor tab's unsaved dot from the active editor", () => {
    fixtures.dirtyKeys = new Set(['document']);
    renderShell();
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
      'data-dirty',
      'true',
    );
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute(
      'data-dirty',
      'false',
    );
    expect(screen.queryByRole('link', { name: 'Versions' })).toBeNull();
  });

  it("lights the General tab's dot for an unsaved trigger or project set", () => {
    for (const key of ['trigger', 'projects']) {
      fixtures.dirtyKeys = new Set([key]);
      const { unmount } = renderShell();
      expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute(
        'data-dirty',
        'true',
      );
      expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
        'data-dirty',
        'false',
      );
      unmount();
    }
  });

  it('shows not-found under the trail, with the divider and no tabs', () => {
    fixtures.automation = null;
    renderShell();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Automation not found' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.getByTestId('title-row')).toHaveAttribute(
      'data-border',
      'own',
    );
    expect(
      screen.queryByRole('navigation', { name: 'Automations navigation' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it("shows not-found for the backend's 404 too, not a loading state forever", () => {
    // The route answers 404 for an unknown slug; the fetch layer surfaces it
    // as a structured refusal, never as null data.
    fixtures.automation = undefined;
    fixtures.error = { data: { code: 'automation not found' } };
    renderShell();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Automation not found' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('navigation', { name: 'Automations navigation' }),
    ).not.toBeInTheDocument();
  });

  // A remembered automation (the Automations rail tile reopening it, see
  // `use-navigation-items.ts`) can be gone by the time the rail click lands.
  // That arrival is marked with `state.navRestore`, and only THAT arrival
  // redirects: a shared link to the same dead automation keeps explaining
  // rather than bouncing away.
  it('drops the stale memory and redirects to the list on a restored arrival', () => {
    fixtures.automation = null;
    fixtures.state = { navRestore: true };
    renderShell();

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations',
      params: { id: 'org-1' },
      replace: true,
    });
  });

  it('does not redirect a restored arrival scoped to a project', () => {
    // Project-scoped automation routes belong to that project's own memory
    // (`features/home/lib/project-memory.ts`), not the org Automations list.
    fixtures.automation = null;
    fixtures.state = { navRestore: true };
    renderShell({ projectId: 'proj-1' });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('passes an axe audit', async () => {
    const { container } = renderShell();
    await checkAccessibility(container);
  });
});

// A navigation AWAY updates `pathname` (and re-runs the write effect) on the
// render just before this component unmounts, so `pathname` no longer
// matches the automation this shell is FOR. Regression for a bug where the
// unguarded effect persisted wherever the user navigated TO — e.g. clicking
// Automations landed on Knowledge or Home, because that's what the shell
// last wrote under its own key on its way out.
describe('AutomationDetailShell — remembering only its own path', () => {
  const OWN_PATH = '/dashboard/org-1/automations/billing__dunning/editor';

  it('persists its own path while genuinely on it', async () => {
    fixtures.pathname = OWN_PATH;
    renderShell();
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.automations.org-1.lastPath'),
      ).toBe(JSON.stringify(OWN_PATH)),
    );
  });

  it('does not overwrite the memory with a pathname that no longer belongs to this automation', async () => {
    fixtures.pathname = OWN_PATH;
    const { rerender } = renderShell();
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.automations.org-1.lastPath'),
      ).toBe(JSON.stringify(OWN_PATH)),
    );

    // Simulate the render right before this shell unmounts on the way to
    // Knowledge: `pathname` has already moved, this component hasn't yet.
    fixtures.pathname = '/dashboard/org-1/documents';
    rerender(
      <AutomationDetailShell
        organizationId="org-1"
        automationSlug="billing/dunning"
      >
        <div />
      </AutomationDetailShell>,
    );

    // The last GOOD path survives untouched — never Knowledge's path.
    await waitFor(() =>
      expect(
        window.localStorage.getItem('tale.platform.automations.org-1.lastPath'),
      ).toBe(JSON.stringify(OWN_PATH)),
    );
  });
});

/**
 * A deleted automation keeps its runs until retention removes them, but the
 * shell read the 404 as "not found" and a run link opened a blank page
 * (2026-09-26 evaluation, D-14). The read now says AUTOMATION_DELETED with
 * the date; the Runs pages render under a banner, the other tabs disable.
 */
describe('AutomationDetailShell — a deleted automation', () => {
  beforeEach(() => {
    fixtures.automation = undefined;
    fixtures.error = {
      data: { code: 'AUTOMATION_DELETED', deletedAt: 1789363170729 },
    };
  });

  it('renders the run page under a deletion banner with Editor disabled', () => {
    fixtures.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs/run-1';
    renderShell();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /This automation was deleted on .*\. Its run history stays until retention removes it\./,
    );
    expect(screen.getByTestId('outlet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
      'data-disabled',
      'true',
    );
    expect(screen.queryByRole('link', { name: 'Versions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'data-disabled',
      'false',
    );
    expect(
      screen.queryByRole('heading', { name: 'Automation not found' }),
    ).not.toBeInTheDocument();
  });

  it('points the editor tab at the run history instead of a dead page', () => {
    fixtures.pathname = '/dashboard/org-1/automations/billing__dunning/editor';
    renderShell();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Automation deleted' }),
    ).toBeVisible();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open the run history' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/$id/automations/$automationSlug/runs',
    );
  });

  // Deleted from the list, an automation stays remembered as the rail's
  // place; reopening it there must land on the list, not on its banner.
  it('drops the stale memory and redirects to the list on a restored arrival', () => {
    fixtures.pathname = '/dashboard/org-1/automations/billing__dunning/editor';
    fixtures.state = { navRestore: true };
    window.localStorage.setItem(
      'tale.platform.automations.org-1.lastPath',
      JSON.stringify(fixtures.pathname),
    );
    renderShell();

    expect(mockNavigate).toHaveBeenCalledExactlyOnceWith({
      to: '/dashboard/$id/automations',
      params: { id: 'org-1' },
      replace: true,
    });
    expect(
      window.localStorage.getItem('tale.platform.automations.org-1.lastPath'),
    ).toBeNull();
  });

  it('keeps explaining the deletion to a deliberate arrival', () => {
    // A shared link or a run link opens the deleted automation on purpose.
    fixtures.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs/run-1';
    renderShell();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('keeps plain not-found for a name that was never saved', () => {
    fixtures.error = { data: { code: 'automation not found' } };
    fixtures.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs/run-1';
    renderShell();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Automation not found' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    fixtures.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs/run-1';
    const { container } = renderShell();
    await checkAccessibility(container);
  });
});
