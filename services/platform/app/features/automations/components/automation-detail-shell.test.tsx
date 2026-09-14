// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationDetailShell } from './automation-detail-shell';

/**
 * The shell is the automation twin of the project detail layout: breadcrumb
 * row, then a tab strip — Editor, Versions, Runs — whose trailing slot the
 * editor fills. These tests pin the strip's shape and where its tabs lead on
 * both route families, and the not-found state that keeps the trail.
 */

const fixtures = vi.hoisted(() => ({
  automation: { name: 'billing/dunning', deployedVersion: 2 } as unknown,
  isPending: false,
  error: undefined as unknown,
  dirtyKeys: undefined as ReadonlySet<string> | undefined,
}));

// The shell reads the location to tell a RESTORED arrival (the rail reopening
// a remembered automation) from a deliberate one, so a deleted automation falls
// back to the list instead of dead-ending. No router is mounted here.
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    pathname: '/dashboard/org-1/automations/sync-emails',
    search: {},
    state: {},
  }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
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

vi.mock('@/app/components/layout/page-layout', () => ({
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

vi.mock('@/app/components/layout/adaptive-header', () => ({
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

vi.mock('@/app/components/ui/editor', () => ({
  ActiveEditorProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useActiveEditor: () =>
    fixtures.dirtyKeys === undefined ? null : { dirtyKeys: fixtures.dirtyKeys },
}));

// Render the strip as plain links so the test reads what a user would see,
// keeping the trailing children (the actions slot) where the strip puts them.
vi.mock('@/app/components/ui/navigation/tab-navigation', () => ({
  TabNavigation: ({
    items,
    ariaLabel,
    children,
    dirtyKeys,
  }: {
    items: Array<{
      label: string;
      href: string;
      matchMode?: string;
      dirtyKeys?: readonly string[];
    }>;
    ariaLabel?: string;
    children?: ReactNode;
    dirtyKeys?: ReadonlySet<string>;
  }) => (
    <nav aria-label={ariaLabel}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          data-match={item.matchMode}
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
});

describe('AutomationDetailShell', () => {
  it('carries the Editor, Versions and Runs tabs on the org route', () => {
    renderShell();
    const strip = screen.getByRole('navigation', {
      name: 'Automations navigation',
    });
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/editor',
    );
    expect(screen.getByRole('link', { name: 'Versions' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/versions',
    );
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
      ['Versions', 'versions'],
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
    expect(screen.getByRole('link', { name: 'Versions' })).toHaveAttribute(
      'data-dirty',
      'false',
    );
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

  it('passes an axe audit', async () => {
    const { container } = renderShell();
    await checkAccessibility(container);
  });
});
