import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DashboardNotFound } from './dashboard-not-found';

// `LinkButton` renders a TanStack `Link`, which needs a router context. Stub it
// to a plain anchor so the component renders standalone.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    href?: string;
  }) => <a href={props.to ?? props.href}>{children}</a>,
}));

describe('DashboardNotFound', () => {
  it('renders a heading, message, and recovery link to the org dashboard', () => {
    render(<DashboardNotFound organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't exist or may have been moved/i),
    ).toBeInTheDocument();

    const backLink = screen.getByRole('link', { name: 'Back to dashboard' });
    expect(backLink).toHaveAttribute('href', '/dashboard/org-1');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DashboardNotFound organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
