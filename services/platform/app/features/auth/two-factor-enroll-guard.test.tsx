// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

// Regression cover for #2085[04]: the /2fa-enroll wall must not trap a user
// who has no reason to be there. An already-enrolled user is bounced back out
// (parity with the forced-change-password guard), while a not-yet-enrolled
// user — enforced or voluntary — stays and gets the enrollment form. The
// guard is scoped to the initial password step so an in-progress enrollment
// is never interrupted (verifyTotp flips twoFactorEnabled before the backup
// codes are shown).

const { mockNavigate, mockSearch, mockStatus } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { value: {} as Record<string, unknown> },
  mockStatus: { value: undefined as unknown },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  // LogoLink renders a router <Link> in the page header.
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  redirect: vi.fn(),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch.value,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: mockStatus.value, isLoading: false }),
}));

vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

// The page calls the bare `toast` export; the verify step's CopyableField
// pulls `useToast` via `useCopy`.
vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
    },
  },
}));

// The passkey dialog drives a WebAuthn browser ceremony irrelevant to the
// guard under test.
vi.mock(
  '@/app/features/settings/account/components/passkey-register-dialog',
  () => ({ PasskeyRegisterDialog: () => null }),
);

import { TwoFactorEnrollPage } from '@/app/routes/2fa-enroll';
import { authClient } from '@/lib/auth-client';

function status(overrides?: Record<string, unknown>) {
  return {
    authenticated: true,
    twoFactorEnabled: false,
    hasPasskey: false,
    enforced: true,
    decision: 'blocked',
    graceUntil: null,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining: null,
    ...overrides,
  };
}

describe('TwoFactorEnrollPage – enrollment-wall guard (#2085[04])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.value = {};
  });

  it('bounces an already-enrolled user off the wall', async () => {
    mockStatus.value = status({ twoFactorEnabled: true, decision: 'ok' });

    render(<TwoFactorEnrollPage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard',
        replace: true,
      }),
    );
  });

  it('honours redirectTo when bouncing an enrolled user', async () => {
    mockStatus.value = status({ twoFactorEnabled: true, decision: 'ok' });
    mockSearch.value = { redirectTo: '/dashboard/org-1/settings/account' };

    render(<TwoFactorEnrollPage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard/org-1/settings/account',
        replace: true,
      }),
    );
  });

  it('keeps a not-yet-enrolled user on the wall with the enrollment form', () => {
    mockStatus.value = status();

    render(<TwoFactorEnrollPage />);

    expect(
      screen.getByRole('button', { name: 'Enable two-factor' }),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('never interrupts an in-progress enrollment when the status flips mid-flow', async () => {
    mockStatus.value = status();
    vi.mocked(authClient.twoFactor.enable).mockResolvedValue({
      data: {
        totpURI: 'otpauth://totp/Tale:user?secret=JBSWY3DPEHPK3PXP',
        backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
      },
      error: null,
      // oxlint-disable-next-line typescript/no-explicit-any -- better-auth's full response envelope is irrelevant to the guard under test
    } as any);

    const { user, rerender } = render(<TwoFactorEnrollPage />);

    await user.type(screen.getByLabelText('Password'), 'hunter2!');
    await user.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await screen.findByLabelText('Verification code');

    // verifyTotp flips twoFactorEnabled server-side before the backup codes
    // are acknowledged — the guard must not bounce the user off the wall now.
    mockStatus.value = status({ twoFactorEnabled: true, decision: 'ok' });
    rerender(<TwoFactorEnrollPage />);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
  });
});
