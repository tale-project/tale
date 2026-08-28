// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationBreadcrumbs } from './automation-breadcrumbs';

const fixtures = vi.hoisted(() => ({
  presentation: undefined as unknown,
  isPending: false,
  onRun: false,
  automations: [] as unknown[],
}));

const mockNavigate = vi.hoisted(() => vi.fn());

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
  activeOptions?: unknown;
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
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to ?? '',
    );
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    );
  }),
  useMatch: ({ from }: { from: string }) => {
    if (!fixtures.onRun) return undefined;
    if (from.includes('/runs/$runId')) return { params: {} };
    return undefined;
  },
  useNavigate: () => mockNavigate,
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
  });

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

  it('always returns Automations to the org hub, even from a project-scoped page', () => {
    fixtures.presentation = undefined;
    fixtures.isPending = false;
    fixtures.onRun = false;

    render(
      <AutomationBreadcrumbs
        organizationId="org-1"
        automationSlug="billing/dunning"
        projectId={asProjectId('proj-1')}
      />,
    );

    expect(screen.getByRole('link', { name: 'Automations' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations',
    );
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
    ).toHaveAttribute('href', '/dashboard/org-1/automations/billing__dunning');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Run' }),
    ).toBeVisible();
    // Mobile back follows the immediate parent — the automation, not the list.
    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/billing__dunning',
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

    expect(
      screen.getByRole('link', { name: 'Chase overdue invoices' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations/billing__dunning',
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
});
