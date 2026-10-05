// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionLapseRedirect } from '@/app/hooks/use-session-lapse-redirect';
import { reportSessionLapsed } from '@/app/lib/auth/session-lapse';
import { render, screen, waitFor, within } from '@/tests/utils/render';

// Regression cover for #2085[19]: disabling 2FA from the Account page must
// warn when the org enforces 2FA — otherwise the user disables it with no
// hint and is hard-walled back into enrollment at their next sign-in. The
// design is warn-not-block (the enrollment wall is the actual enforcement),
// so the disable call itself must keep working.

const { mockStatus, showBackupCodes } = vi.hoisted(() => ({
  mockStatus: { value: {} },
  showBackupCodes: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: mockStatus.value, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
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
  useShowBackupCodes: () => showBackupCodes,
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

describe('TwoFactorSection – a refused password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function confirmIn(dialogName: string, button: string) {
    const { user } = render(<TwoFactorSection />);
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog', { name: dialogName });
    await user.type(within(dialog).getByLabelText('Password'), 'guess');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    return dialog;
  }

  it('words a wrong password and warns that repeated ones lock the account', async () => {
    mockStatus.value = enrolledStatus(false);
    vi.mocked(authClient.twoFactor.disable).mockResolvedValueOnce({
      data: null,
      error: {
        status: 400,
        statusText: 'BAD_REQUEST',
        code: 'INVALID_PASSWORD',
        message: 'Invalid password',
      },
    } as never);

    const dialog = await confirmIn('Disable', 'Disable');

    expect(
      await within(dialog).findByText(
        'Wrong password. Repeated failed attempts temporarily lock your account.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Invalid password')).toBeNull();
  });

  it('says how long a locked account waits', async () => {
    mockStatus.value = { ...enrolledStatus(false), twoFactorEnabled: false };
    vi.mocked(authClient.twoFactor.enable).mockResolvedValueOnce({
      data: null,
      error: {
        status: 429,
        statusText: 'TOO_MANY_REQUESTS',
        message: 'Invalid credentials',
        retryAfter: 120,
      },
    } as never);

    const dialog = await confirmIn('Enable two-factor', 'Enable two-factor');

    expect(
      await within(dialog).findByText(
        'Account temporarily locked. Try again in 2 minutes, or contact an administrator.',
      ),
    ).toBeInTheDocument();
  });
});

describe('TwoFactorSection session rotation', () => {
  const originalLocation = window.location;
  let navigations: string[];

  function AccountWithLapseRecovery() {
    useSessionLapseRedirect(true);
    return <TwoFactorSection />;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    navigations = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/dashboard/org-1/settings/account',
        search: '',
        hash: '',
        set href(value: string) {
          navigations.push(value);
        },
      },
    });
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: null,
      error: null,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('keeps enrollment and its backup codes while the new session cookie is pending', async () => {
    mockStatus.value = { ...enrolledStatus(false), twoFactorEnabled: false };
    vi.mocked(authClient.twoFactor.enable).mockResolvedValue({
      data: {
        method: 'totp',
        totpURI: 'otpauth://totp/Tale:test?secret=JBSWY3DPEHPK3PXP&issuer=Tale',
        backupCodes: ['test-backup-code'],
      },
      error: null,
    });
    let verified = () => {};
    vi.mocked(authClient.twoFactor.verifyTotp).mockImplementation(
      () =>
        new Promise((resolve) => {
          verified = () =>
            resolve({
              data: { token: 'new-session', user: {} } as never,
              error: null,
            });
        }),
    );
    const { user } = render(<AccountWithLapseRecovery />);
    await user.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Password'), 'test-password');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    dialog = await screen.findByRole('dialog', {
      name: 'Set up two-factor authentication',
    });
    await user.type(
      within(dialog).getByLabelText('Verification code'),
      '123456',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Verify and enable' }),
    );
    expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledOnce();

    // The server has retired the old token, but this response has not yet
    // installed the replacement cookie in the browser.
    await act(async () => {
      reportSessionLapsed();
    });
    expect(navigations).toEqual([]);
    expect(authClient.getSession).not.toHaveBeenCalled();
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: { user: { id: 'u-1' }, session: { id: 'new-session' } } as never,
      error: null,
    });
    await act(async () => {
      verified();
    });

    await waitFor(() =>
      expect(showBackupCodes).toHaveBeenCalledWith(['test-backup-code']),
    );
    await waitFor(() => expect(authClient.getSession).toHaveBeenCalledOnce());
    expect(navigations).toEqual([]);
  });

  it('waits for the replacement cookie when disabling two-factor authentication', async () => {
    mockStatus.value = enrolledStatus(false);
    let disabled = () => {};
    vi.mocked(authClient.twoFactor.disable).mockImplementation(
      () =>
        new Promise((resolve) => {
          disabled = () => resolve({ data: { status: true }, error: null });
        }),
    );
    const { user } = render(<AccountWithLapseRecovery />);
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Password'), 'test-password');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(authClient.twoFactor.disable).toHaveBeenCalledOnce();
    await act(async () => {
      reportSessionLapsed();
    });
    expect(navigations).toEqual([]);
    expect(authClient.getSession).not.toHaveBeenCalled();
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: { user: { id: 'u-1' }, session: { id: 'new-session' } } as never,
      error: null,
    });
    await act(async () => {
      disabled();
    });
    await waitFor(() => expect(authClient.getSession).toHaveBeenCalledOnce());
    expect(navigations).toEqual([]);
  });
});
