// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { AutomationBreadcrumbs } from './automation-breadcrumbs';

const fixtures = vi.hoisted(() => ({
  presentation: undefined as unknown,
  isPending: false,
  onRun: false,
  automations: [] as unknown[],
  projectRead: {
    project: { name: 'Apollo' } as { name: string } | null,
    isLoading: false,
    unavailable: false,
  },
  projectReadArgs: [] as (string | undefined)[],
}));

const mockNavigate = vi.hoisted(() => vi.fn());

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
  activeOptions?: unknown;
}

/** The path a mocked link resolves to: `to` with its params filled in. */
function mockHref({ to, params }: Pick<MockLinkProps, 'to' | 'params'>) {
  return Object.entries(params ?? {}).reduce(
    (path, [key, value]) => path.replace(`$${key}`, value),
    to ?? '',
  );
}

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    {
      to,
      params,
      preload: _preload,
      activeOptions: _active,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <a ref={ref} href={mockHref({ to, params })} {...rest}>
        {children}
      </a>
    );
  }),
  // A link over the caller's own anchor: the anchor gets the resolved href
  // and every prop the router does not consume.
  createLink: (Anchor: React.ComponentType<Record<string, unknown>>) =>
    function CreatedLink({
      to,
      params,
      preload: _preload,
      activeOptions: _active,
      ...rest
    }: MockLinkProps & Record<string, unknown>) {
      return <Anchor href={mockHref({ to, params })} {...rest} />;
    },
  useMatch: ({ from }: { from: string }) => {
    if (!fixtures.onRun) return undefined;
    if (from.includes('/runs/$runId')) return { params: {} };
    return undefined;
  },
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    pathname: '/dashboard/org-1/automations/billing__dunning/editor',
  }),
}));

// The project the automation is opened in; the project shell already read it.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: (projectId: string | undefined) => {
    fixtures.projectReadArgs.push(projectId);
    return fixtures.projectRead;
  },
}));

vi.mock('../hooks/queries', () => ({
  useAutomation: () => ({
    data: {
      document: { name: 'billing/dunning', nodes: [] },
      ...(fixtures.presentation !== undefined
        ? { presentation: fixtures.presentation }
        : {}),
    },
    isPending: fixtures.isPending,
  }),
  useAutomations: () => ({
    data: fixtures.automations,
    isPending: false,
  }),
}));

describe('AutomationBreadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.presentation = undefined;
    fixtures.isPending = false;
    fixtures.onRun = false;
    // Empty listing → the leaf renders the plain name, so the cases that
    // assert exact h1 names stay valid without knowing about the switcher.
    fixtures.automations = [];
    fixtures.projectRead = {
      project: { name: 'Apollo' },
      isLoading: false,
      unavailable: false,
    };
    fixtures.projectReadArgs = [];
  });

  /** The trail's ancestor links, in order — the desktop trail only, without
   *  the phone's back control. */
  function trailLinks() {
    const trail = screen.getByRole('list');
    return within(trail)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
  }

  it('links Automations back to the org list and heads with the pack name', () => {
    fixtures.presentation = {
      name: 'Chase overdue invoices',
      description: 'Sends the dunning ladder.',
    };
    fixtures.isPending = false;
    fixtures.onRun = false;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    const parent = screen.getByRole('link', { name: 'Automations' });
    expect(parent).toHaveAttribute('href', '/dashboard/org-1/automations');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Chase overdue invoices',
      }),
    ).toBeVisible();
  });

  it('falls back to the slug read as a title when nothing was declared', () => {
    fixtures.presentation = undefined;
    fixtures.isPending = false;
    fixtures.onRun = false;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dunning' }),
    ).toBeVisible();
  });

  it('starts the trail at the project an automation is opened in', () => {
    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    // The project leads back to the project, Automations to the project's
    // own Automations tab — where the automation was opened from.
    expect(trailLinks()).toEqual([
      ['Apollo', '/dashboard/org-1/projects/proj-1'],
      ['Automations', '/dashboard/org-1/projects/proj-1/automations'],
    ]);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dunning' }),
    ).toBeVisible();
    expect(fixtures.projectReadArgs).toContain('proj-1');
  });

  it("returns the phone's back arrow to the project's Automations tab", () => {
    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveClass('md:hidden');
    expect(back).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations',
    );
  });

  it('falls back to the organization trail when the project is gone', () => {
    // Deleted, or out of this person's reach: the read answers without a
    // project, and its Automations tab would only say it was not found.
    fixtures.projectRead = {
      project: null,
      isLoading: false,
      unavailable: false,
    };

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    expect(trailLinks()).toEqual([
      ['Automations', '/dashboard/org-1/automations'],
    ]);
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations',
    );
  });

  it("keeps a gone project's run on the route it was opened under", () => {
    fixtures.projectRead = {
      project: null,
      isLoading: false,
      unavailable: false,
    };
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.onRun = true;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    // The automation's own pages open without their project, so the name
    // still leads there; only the list falls back to the organization's.
    expect(trailLinks()).toEqual([
      ['Automations', '/dashboard/org-1/automations'],
      [
        'Chase overdue invoices',
        '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor',
      ],
    ]);
  });

  it('falls back to the project list when the project read fails', () => {
    // A failed read is not a gone project: the project's Automations tab
    // names the failure and offers a retry, so the trail keeps leading there.
    fixtures.projectRead = {
      project: null,
      isLoading: false,
      unavailable: true,
    };

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    expect(trailLinks()).toEqual([
      ['Projects', '/dashboard/org-1/projects'],
      ['Automations', '/dashboard/org-1/projects/proj-1/automations'],
    ]);
  });

  it('holds the project crumb as a skeleton while the project loads', () => {
    fixtures.projectRead = {
      project: null,
      isLoading: true,
      unavailable: false,
    };

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    expect(trailLinks()).toEqual([
      ['Automations', '/dashboard/org-1/projects/proj-1/automations'],
    ]);
    expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull();
  });

  it('reads no project outside one', () => {
    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    expect(trailLinks()).toEqual([
      ['Automations', '/dashboard/org-1/automations'],
    ]);
    // Asked with no project, the read is skipped.
    expect(fixtures.projectReadArgs.length).toBeGreaterThan(0);
    expect(
      fixtures.projectReadArgs.every((projectId) => projectId === undefined),
    ).toBe(true);
  });

  it('on a run, links the automation name back to the automation page', () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.isPending = false;
    fixtures.onRun = true;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    expect(
      screen.getByRole('link', { name: 'Chase overdue invoices' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/editor',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Run' }),
    ).toBeVisible();
    // Mobile back follows the immediate parent — the automation, not the list.
    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning/editor',
    );
  });

  it('on a project run, the name crumb stays on the project automation route', () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.isPending = false;
    fixtures.onRun = true;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    expect(trailLinks()).toEqual([
      ['Apollo', '/dashboard/org-1/projects/proj-1'],
      ['Automations', '/dashboard/org-1/projects/proj-1/automations'],
      [
        'Chase overdue invoices',
        '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor',
      ],
    ]);
    // Mobile back follows the immediate parent — the automation.
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor',
    );
  });

  it('exposes a mobile back control to the parent list', () => {
    fixtures.presentation = undefined;
    fixtures.isPending = false;
    fixtures.onRun = false;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveClass('md:hidden');
    expect(back).toHaveAttribute('href', '/dashboard/org-1/automations');
  });

  it('offers sibling automations from the name leaf', () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.automations = [
      { name: 'billing/dunning', latest: 1, projectIds: [] },
      { name: 'billing/reminders', latest: 1, projectIds: [] },
    ];

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    // The leaf is the switcher trigger; the page h1's accessible name is the
    // trigger's aria-label, which carries the display name.
    expect(
      screen.getByRole('button', {
        name: 'Switch automation, current: Chase overdue invoices',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Chase overdue invoices/,
      }),
    ).toBeVisible();
  });

  it('keeps the run leaf plain — no switcher on a run page', () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.onRun = true;
    fixtures.automations = [
      { name: 'billing/dunning', latest: 1, projectIds: [] },
      { name: 'billing/reminders', latest: 1, projectIds: [] },
    ];

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );

    expect(
      screen.queryByRole('button', { name: /switch automation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Run' }),
    ).toBeVisible();
  });

  it('passes an axe audit', async () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };
    fixtures.isPending = false;
    fixtures.onRun = false;

    const { container } = render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
      />,
    );
    await checkAccessibility(container);
  });

  it('passes an axe audit inside a project', async () => {
    fixtures.presentation = { name: 'Chase overdue invoices' };

    const { container } = render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );
    await checkAccessibility(container);
  });
});
