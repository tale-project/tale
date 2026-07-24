// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

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
  | Array<{ name: string; latest: number; deployedVersion?: number }>
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
// These tests pin the link split — a project row must stay inside the project
// shell, an org row on the org routes.
describe('AutomationsList link targets', () => {
  it('links an org-page row to the org automation route', () => {
    automationsData = [{ name: 'org/digest', latest: 2, deployedVersion: 2 }];
    render(<AutomationsList organizationId="org-1" />);

    const link = screen.getByRole('link', { name: /org\/digest/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/org__digest',
    );
  });

  it('links a project-tab row into the project shell', () => {
    automationsData = [{ name: 'desk/prepare-return', latest: 1 }];
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
});
