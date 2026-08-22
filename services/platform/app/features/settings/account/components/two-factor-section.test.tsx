// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

// Regression cover for #2085[19]: disabling 2FA from the Account page must
// warn when the org enforces 2FA — otherwise the user disables it with no
// hint and is hard-walled back into enrollment at their next sign-in. The
// design is warn-not-block (the enrollment wall is the actual enforcement),
// so the disable call itself must keep working.

const { mockStatus } = vi.hoisted(() => ({
  mockStatus: { value: {} },
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: mockStatus.value }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    twoFactor: {
      disable: vi.fn().mockResolvedValue({}),
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
  },
}));

// The backup-codes dialog lives in a root provider; the section only needs
// the show() callback.
vi.mock('./backup-codes-dialog-provider', () => ({
  useShowBackupCodes: () => vi.fn(),
}));

// FormDialog resolves the org id from router params for its unsaved-changes
// guard; there is no router in a component test.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

import { authClient } from '@/lib/auth-client';

import { TwoFactorSection } from './two-factor-section';

function enrolledStatus(enforced: boolean) {
  return {
    authenticated: true,
    twoFactorEnabled: true,
    hasPasskey: false,
    enforced,
    decision: 'ok',
    graceUntil: null,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining: 10,
  };
}

const ENFORCED_WARNING =
  /your organization requires two-factor authentication\. if you disable it/i;

describe('TwoFactorSection – disable under org enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a standing warning in the disable dialog when the org enforces 2FA (#2085[19])', async () => {
    mockStatus.value = enrolledStatus(true);
    const { user } = render(<TwoFactorSection />);

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    const dialog = await screen.findByRole('dialog', { name: 'Disable' });
    expect(within(dialog).getByText(ENFORCED_WARNING)).toBeInTheDocument();
  });

  it('shows no enforcement warning when the org does not enforce 2FA', async () => {
    mockStatus.value = enrolledStatus(false);
    const { user } = render(<TwoFactorSection />);

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    const dialog = await screen.findByRole('dialog', { name: 'Disable' });
    expect(
      within(dialog).queryByText(ENFORCED_WARNING),
    ).not.toBeInTheDocument();
  });

  it('still allows the disable to proceed (warn, not block)', async () => {
    mockStatus.value = enrolledStatus(true);
    const { user } = render(<TwoFactorSection />);

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disable' });

    await user.type(within(dialog).getByLabelText('Password'), 'hunter2!');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(authClient.twoFactor.disable).toHaveBeenCalledWith({
        password: 'hunter2!',
      }),
    );
  });
});
