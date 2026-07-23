import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../messages/en.yml';
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

// User-visible copy is asserted through the en.json catalog (never an English
// literal), keeping the test locale-safe and aligned with the i18n contract.
const notFound = enMessages.common.notFound;

describe('DashboardNotFound', () => {
  // Happy path: the styled 404 renders a heading, message, and a recovery link
  // pointing back at the org dashboard.
  it('renders a heading, message, and recovery link to the org dashboard', () => {
    render(<DashboardNotFound organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(notFound.description)).toBeInTheDocument();

    const backLink = screen.getByRole('link', {
      name: notFound.backToDashboard,
    });
    expect(backLink).toHaveAttribute('href', '/dashboard/org-1');
  });

  // Edge case: an empty organizationId still renders a recovery link, pointed at
  // the dashboard root rather than producing a broken href.
  it('builds the recovery link to the dashboard root when organizationId is empty', () => {
    render(<DashboardNotFound organizationId="" />);

    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard/');
  });

  // Error scenario: this surface is reached precisely when the user hits a
  // mistyped/stale deep URL. Even for a garbage splat id, the 404 must stay
  // well-formed — exactly one heading and one recovery link so the user can
  // always escape the error state.
  it('stays a single, recoverable error surface for an unknown deep-path id', () => {
    render(
      <DashboardNotFound organizationId="acme/this-route-does-not-exist" />,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const backLinks = screen.getAllByRole('link', {
      name: notFound.backToDashboard,
    });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute(
      'href',
      '/dashboard/acme/this-route-does-not-exist',
    );
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
