// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Regression cover for #2085[05]: like its grace sibling, this persistent
// dashboard banner must be a polite `status` live region — an assertive
// `alert` role would interrupt screen-reader users on every dashboard visit.

const { mockStatus } = vi.hoisted(() => ({
  mockStatus: { value: undefined as unknown },
}));

vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => mockStatus.value,
}));

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

import { TwoFactorLowBackupCodesBanner } from './two-factor-low-backup-codes-banner';

function enrolledStatus(backupCodesRemaining: number | null) {
  return {
    authenticated: true,
    twoFactorEnabled: true,
    hasPasskey: false,
    enforced: false,
    decision: 'ok',
    graceUntil: null,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining,
  };
}

describe('TwoFactorLowBackupCodesBanner', () => {
  it('renders as a polite status region, never an assertive alert (#2085[05])', () => {
    mockStatus.value = enrolledStatus(2);

    render(<TwoFactorLowBackupCodesBanner organizationId="org-1" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Only 2 backup codes remaining');
    expect(
      screen.getByRole('link', { name: 'Regenerate now' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing while the backup-code pool is healthy', () => {
    mockStatus.value = enrolledStatus(8);

    render(<TwoFactorLowBackupCodesBanner organizationId="org-1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
