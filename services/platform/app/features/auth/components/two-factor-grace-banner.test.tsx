// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Regression cover for #2085[05]: this banner is persistent dashboard chrome,
// not a live interruption — it must expose the polite `status` role so screen
// readers announce it after the current utterance, never the assertive
// `alert` role it originally shipped with.

const { mockStatus } = vi.hoisted(() => ({
  mockStatus: { value: undefined as unknown },
}));

vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => mockStatus.value,
}));

// The CTA is a TanStack Router <Link>; a plain anchor keeps the test free of a
// full router while preserving the accessible link semantics under assertion.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { TwoFactorGraceBanner } from './two-factor-grace-banner';

const DAY_MS = 24 * 60 * 60 * 1000;

function graceStatus(overrides?: Record<string, unknown>) {
  return {
    authenticated: true,
    twoFactorEnabled: false,
    hasPasskey: false,
    enforced: true,
    decision: 'grace',
    graceUntil: Date.now() + 3 * DAY_MS,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining: null,
    ...overrides,
  };
}

describe('TwoFactorGraceBanner', () => {
  it('renders as a polite status region, never an assertive alert (#2085[05])', () => {
    mockStatus.value = graceStatus();

    render(<TwoFactorGraceBanner organizationId="org-1" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/two-factor authentication required/i);
    expect(
      screen.getByRole('link', { name: 'Set up now' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing when the user is not in the grace window', () => {
    mockStatus.value = graceStatus({ decision: 'ok', graceUntil: null });

    render(<TwoFactorGraceBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
