// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

// The org listing resolves project names for its project chips; the link
// tests only assert hrefs, so stub the provider-backed projects hook.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [], isLoading: false }),
}));

// Grant authoring so the header renders its create menu. The lane dialogs
// mount lazily on pick, so their builder/upload hooks stay out of these
// tests entirely.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
}

vi.mock('@tanstack/react-router', () => ({
  // A real <Link> needs a mounted RouterProvider; these tests only assert the
  // resolved targets, so the mock interpolates `params` into the `to`
  // template and renders a plain anchor (sidebar-nav.test.tsx's pattern).
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params, preload: _preload, children, ...rest },
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

// The list serves two surfaces: the org page and a project's Automations tab.
// These tests pin the link split — a single-bound row stays inside its
// project shell, org-level and multi-bound rows stay on the org routes.
describe('AutomationsList link targets', () => {
  it('links an org-page row to the org automation route', () => {
    automationsData = [
      { name: 'org/digest', latest: 2, projectIds: [], deployedVersion: 2 },
    ];
    render(<AutomationsList organizationId="org-1" />);

    const link = screen.getByRole('link', { name: /org\/digest/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/org__digest',
    );
  });

  it('links a project-tab row into the project shell', () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: [] },
    ];
    render(
      <AutomationsList
        organizationId="org-1"
        projectId={'proj_1' as Id<'projects'>}
      />,
    );

    const link = screen.getByRole('link', { name: /desk\/prepare-return/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj_1/automations/desk__prepare-return',
    );
  });

  it('routes a single-bound org-page row into its project shell', () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: ['proj_1'] },
    ];
    render(<AutomationsList organizationId="org-1" />);

    const link = screen.getByRole('link', { name: /desk\/prepare-return/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj_1/automations/desk__prepare-return',
    );
  });

  it('keeps a multi-bound row on the org route and shows every project chip', () => {
    automationsData = [
      {
        name: 'desk/prepare-return',
        latest: 1,
        projectIds: ['proj_1', 'proj_2'],
      },
    ];
    render(<AutomationsList organizationId="org-1" />);

    const link = screen.getByRole('link', { name: /desk\/prepare-return/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/desk__prepare-return',
    );
    // No project names are loaded in this test, so both chips fall back to
    // the generic label (the i18n mock echoes the key) — one per binding.
    expect(
      within(link).getAllByText('automations.list.projectBound'),
    ).toHaveLength(2);
  });
});

// The header offers ONE create entry — the skill library's grammar: a primary
// button whose menu holds the lanes (author from a goal, upload a pack), not
// two side-by-side buttons.
describe('AutomationsList create menu', () => {
  it('offers both create lanes from the one button', async () => {
    automationsData = [];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByTestId('new-automation'));

    expect(
      screen.getByRole('menuitem', { name: 'automations.createMenu.fromGoal' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'automations.upload.trigger' }),
    ).toBeInTheDocument();
  });
});
