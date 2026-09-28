// @vitest-environment jsdom
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '@tale/shared/schemas/governance';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { useSessionLapseRedirect } from '@/app/hooks/use-session-lapse-redirect';
import { reportSessionLapsed } from '@/app/lib/auth/session-lapse';
import { render, screen, waitFor, within } from '@/tests/utils/render';

// A member's password dialogs used to read the organization's policy through
// the admin-only governance door. A member got a 403 there and was shown
// the built-in default instead, while the password write held them to the
// stricter organization's rules. The dialogs now read the caller's effective
// policy; these cases drive the real adapter row over a stubbed `fetch`.

const { mockHasCredential, mockToast, mockGetSession, mockSignOut } =
  vi.hoisted(() => ({
    mockHasCredential: { value: true },
    mockToast: vi.fn(),
    mockGetSession: vi.fn(),
    mockSignOut: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mockGetSession },
}));

vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasCredentialAccount: () => ({
    data: mockHasCredential.value,
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({
    user: { userId: 'member-1', email: 'member@example.test', name: 'Mia' },
    isLoading: false,
    signOut: mockSignOut,
  }),
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

// The other sections read their own backends; none of them is under test.
vi.mock('./role-section', () => ({ RoleSection: () => null }));
vi.mock('./teams-section', () => ({ TeamsSection: () => null }));
vi.mock('./two-factor-section', () => ({ TwoFactorSection: () => null }));
vi.mock('./passkey-section', () => ({ PasskeySection: () => null }));
vi.mock('./chats-section', () => ({ ChatsSection: () => null }));

import { AccountForm } from './account-form';

/** An organization stricter than the built-in default (12 characters). */
const STRICT_POLICY: PasswordPolicyConfig = {
  ...DEFAULT_PASSWORD_POLICY,
  minLength: 20,
};

/** Every character class and 15 characters: enough for the default only. */
const DEFAULT_GRADE_PASSWORD = 'Tale-Passw0rd!2';
/** Meets the strict organization's rules. */
const STRICT_GRADE_PASSWORD = 'Tale-Passw0rd!-long-2';
const POLICY_VIOLATION =
  "This password doesn't meet your organization's password policy.";

/** How one effective-policy read answers: the strict policy, a 404 (a
 * backend without the route), or held open until `releasePolicy()`. */
type PolicyAnswer = 'strict' | 'held' | 'missing';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof Request ? input.url : input.href;
}

/**
 * The backend as a member sees it: the admin-only policy door refuses them,
 * the effective-policy read answers per `policy`, and the password write
 * answers per `write`. Every request path is recorded.
 */
function stubBackend(answers: {
  policy: PolicyAnswer[];
  write?: Response | Promise<Response>;
}): {
  paths: string[];
  releasePolicy: () => void;
} {
  const paths: string[] = [];
  const policyAnswers = [...answers.policy];
  const held: Array<(response: Response) => void> = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    paths.push(path);
    if (path.startsWith('/api/app/governance/policies/')) {
      return json({ error: 'FORBIDDEN' }, 403);
    }
    if (path === '/api/app/users/me/password-policy') {
      const answer = policyAnswers.shift() ?? 'strict';
      if (answer === 'held') {
        return new Promise<Response>((resolve) => held.push(resolve));
      }
      if (answer === 'missing') return json({ error: 'Not Found' }, 404);
      return json({ policy: STRICT_POLICY });
    }
    if (path.startsWith('/api/app/users/update-password')) {
      return (
        (await answers.write)?.clone() ??
        json({ ok: true, passwordExpiry: null })
      );
    }
    return json({ error: 'Not Found' }, 404);
  });
  return {
    paths,
    releasePolicy: () => {
      for (const resolve of held.splice(0)) {
        resolve(json({ policy: STRICT_POLICY }));
      }
    },
  };
}

function AccountWithLapseRecovery() {
  const recovery = useSessionLapseRedirect(true);
  return (
    <>
      <AccountForm />
      <SessionLapseRecovery recovery={recovery} />
    </>
  );
}

function renderAccountForm(withLapseRecovery = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      {withLapseRecovery ? <AccountWithLapseRecovery /> : <AccountForm />}
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

async function openDialog(
  user: ReturnType<typeof renderAccountForm>['user'],
  name: 'Change password' | 'Set password',
) {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  mockHasCredential.value = true;
  mockToast.mockClear();
});

describe('Change password session revocation', () => {
  const originalLocation = window.location;
  let navigations: string[];

  beforeEach(() => {
    navigations = [];
    mockGetSession.mockReset().mockResolvedValue({ data: null, error: null });
    mockSignOut.mockClear();
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
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  async function submitPassword() {
    const { user } = renderAccountForm(true);
    const dialog = await openDialog(user, 'Change password');
    await user.type(
      within(dialog).getByLabelText('Current password'),
      'current-password',
    );
    await user.type(
      within(dialog).getByLabelText('New password'),
      STRICT_GRADE_PASSWORD,
    );
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      STRICT_GRADE_PASSWORD,
    );
    const submit = within(dialog).getByRole('button', {
      name: 'Change password',
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    return dialog;
  }

  it('releases the hold when the password write is refused', async () => {
    let refuse = () => {};
    const write = new Promise<Response>((resolve) => {
      refuse = () =>
        resolve(
          json(
            {
              error: 'Current password is incorrect',
              code: 'INVALID_CURRENT_PASSWORD',
            },
            400,
          ),
        );
    });
    const { paths } = stubBackend({ policy: ['strict'], write });
    const dialog = await submitPassword();
    await waitFor(() =>
      expect(
        paths.filter((path) =>
          path.startsWith('/api/app/users/update-password'),
        ),
      ).toHaveLength(1),
    );
    await act(async () => {
      reportSessionLapsed();
    });
    expect(navigations).toEqual([]);
    mockGetSession.mockResolvedValue({
      data: { user: { id: 'member-1' } },
      error: null,
    });
    await act(async () => {
      refuse();
    });
    expect(
      await within(dialog).findByText('Current password is incorrect'),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledOnce());
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
  });

  it('finishes password-change cleanup and its own navigation after session revocation', async () => {
    let changed = () => {};
    const write = new Promise<Response>((resolve) => {
      changed = () => resolve(json({ ok: true, passwordExpiry: null }));
    });
    const { paths } = stubBackend({ policy: ['strict'], write });
    await submitPassword();
    await waitFor(() =>
      expect(
        paths.filter((path) =>
          path.startsWith('/api/app/users/update-password'),
        ),
      ).toHaveLength(1),
    );
    await act(async () => {
      reportSessionLapsed();
    });
    expect(navigations).toEqual([]);
    await act(async () => {
      changed();
    });
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce());
    reportSessionLapsed();
    await act(async () => {});
    expect(navigations).toEqual(['/']);

    // The browser can keep this document if its dirty-editor prompt cancels
    // the leave. A later refusal must recover after the unload guard expires.
    window.dispatchEvent(new Event('beforeunload'));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001);
    await act(async () => {});
    reportSessionLapsed();
    await screen.findByRole('button', { name: 'Stay here' });
    expect(navigations).toEqual(['/']);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('Change password — a member of an organization stricter than the default', () => {
  it('shows the organization’s rules and holds the new password to them', async () => {
    const { paths } = stubBackend({ policy: ['strict'] });
    const { user } = renderAccountForm();
    const dialog = await openDialog(user, 'Change password');

    await user.type(
      within(dialog).getByLabelText('Current password'),
      'current-password',
    );
    await user.type(
      within(dialog).getByLabelText('New password'),
      DEFAULT_GRADE_PASSWORD,
    );
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      DEFAULT_GRADE_PASSWORD,
    );

    // The real minimum, unmet — not the default's twelve characters.
    expect(
      await within(dialog).findByRole('listitem', {
        name: 'At least 20 characters: invalid',
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText('At least 12 characters'),
    ).not.toBeInTheDocument();
    // Held to it: a password the default accepts cannot be submitted.
    const submit = within(dialog).getByRole('button', {
      name: 'Change password',
    });
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('New password'));
    await user.type(
      within(dialog).getByLabelText('New password'),
      STRICT_GRADE_PASSWORD,
    );
    await user.clear(within(dialog).getByLabelText('Confirm new password'));
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      STRICT_GRADE_PASSWORD,
    );
    expect(
      within(dialog).getByRole('listitem', {
        name: 'At least 20 characters: valid',
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(submit).toBeEnabled());

    // The admin-only door is never asked.
    expect(
      paths.filter((path) => path.startsWith('/api/app/governance/')),
    ).toEqual([]);
  });

  it('applies no default rules while the policy is loading, and shows the server’s refusal', async () => {
    const { releasePolicy } = stubBackend({
      policy: ['held'],
      write: json({ error: 'password_policy_violation' }, 400),
    });
    const { user } = renderAccountForm();
    const dialog = await openDialog(user, 'Change password');

    // Far below the default's rules: only the server can judge it now.
    await user.type(
      within(dialog).getByLabelText('Current password'),
      'current-password',
    );
    await user.type(within(dialog).getByLabelText('New password'), 'short');
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      'short',
    );
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();

    const submit = within(dialog).getByRole('button', {
      name: 'Change password',
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(
      await within(dialog).findByText(POLICY_VIOLATION),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('New password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mockToast).not.toHaveBeenCalled();

    // Once the rules land, the checklist shows them.
    releasePolicy();
    expect(
      await within(dialog).findByRole('listitem', {
        name: 'At least 20 characters: invalid',
      }),
    ).toBeInTheDocument();
  });

  it('re-reads the rules the server refused the password under when the first read failed', async () => {
    const { paths } = stubBackend({
      policy: ['missing', 'strict'],
      write: json({ error: 'password_policy_violation' }, 400),
    });
    const { user } = renderAccountForm();
    const dialog = await openDialog(user, 'Change password');

    await user.type(
      within(dialog).getByLabelText('Current password'),
      'current-password',
    );
    await user.type(within(dialog).getByLabelText('New password'), 'short');
    await user.type(
      within(dialog).getByLabelText('Confirm new password'),
      'short',
    );
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Change password' }),
    );

    expect(
      await within(dialog).findByText(POLICY_VIOLATION),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByRole('listitem', {
        name: 'At least 20 characters: invalid',
      }),
    ).toBeInTheDocument();
    expect(
      paths.filter((path) => path === '/api/app/users/me/password-policy'),
    ).toHaveLength(2);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe('Set password — an account without a password yet', () => {
  it('lets the server decide when the policy cannot be read', async () => {
    mockHasCredential.value = false;
    const { paths } = stubBackend({ policy: ['missing'] });
    const { user } = renderAccountForm();
    const dialog = await openDialog(user, 'Set password');

    await user.type(within(dialog).getByLabelText('New password'), 'short');
    await user.type(within(dialog).getByLabelText('Confirm password'), 'short');
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();

    const submit = within(dialog).getByRole('button', { name: 'Set password' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Password set' }),
      ),
    );
    expect(
      paths.filter((path) => path.startsWith('/api/app/users/update-password')),
    ).toHaveLength(1);
  });

  it('shows the organization’s rules once they are read', async () => {
    mockHasCredential.value = false;
    stubBackend({ policy: ['strict'] });
    const { user } = renderAccountForm();
    const dialog = await openDialog(user, 'Set password');

    await user.type(
      within(dialog).getByLabelText('New password'),
      DEFAULT_GRADE_PASSWORD,
    );

    expect(
      await within(dialog).findByRole('listitem', {
        name: 'At least 20 characters: invalid',
      }),
    ).toBeInTheDocument();
  });
});
