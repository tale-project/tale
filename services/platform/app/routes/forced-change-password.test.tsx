// @vitest-environment jsdom
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '@tale/shared/schemas/governance';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

// The forced-change wall used to read the organization's policy through the
// admin-only governance door, so a member on it was shown the built-in
// default while the password write held them to the organization's stricter
// rules. It now reads the caller's effective policy over the real adapter
// row; `fetch` is stubbed as a member's backend answers.

const { mockNavigate, mockToast } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useParams: () => ({ id: 'org-1' }),
  }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  redirect: vi.fn(),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: vi.fn() },
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({
    user: { userId: 'member-1', email: 'member@example.test' },
    isLoading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

import { ForcedChangePasswordPage } from './forced-change-password.$id';

/** An organization stricter than the built-in default (12 characters). */
const STRICT_POLICY: PasswordPolicyConfig = {
  ...DEFAULT_PASSWORD_POLICY,
  minLength: 20,
};
/** Every character class and 15 characters: enough for the default only. */
const DEFAULT_GRADE_PASSWORD = 'Tale-Passw0rd!2';
/** Meets the strict organization's rules. */
const STRICT_GRADE_PASSWORD = 'Tale-Passw0rd!-long-2';

const EXPIRED = {
  expired: true,
  reason: 'admin_set',
  hasCredential: true,
  daysUntilExpiry: 0,
  rotationEnabled: false,
};

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

function stubBackend(answers: {
  policy: 'strict' | 'missing';
  write: Response;
}): { paths: string[] } {
  const paths: string[] = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    paths.push(path);
    if (path === '/api/app/users/password-expiry') return json(EXPIRED);
    if (path.startsWith('/api/app/governance/policies/')) {
      return json({ error: 'FORBIDDEN' }, 403);
    }
    if (path === '/api/app/users/me/password-policy') {
      return answers.policy === 'strict'
        ? json({ policy: STRICT_POLICY })
        : json({ error: 'Not Found' }, 404);
    }
    if (path.startsWith('/api/app/users/update-password')) {
      return answers.write.clone();
    }
    return json({ error: 'Not Found' }, 404);
  });
  return { paths };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ForcedChangePasswordPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  mockNavigate.mockClear();
  mockToast.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('ForcedChangePasswordPage — a member of an organization stricter than the default', () => {
  it('shows the organization’s rules, holds the new password to them, and releases the wall', async () => {
    const { paths } = stubBackend({
      policy: 'strict',
      write: json({
        ok: true,
        passwordExpiry: { ...EXPIRED, expired: false, reason: null },
      }),
    });
    const { user } = renderPage();
    const submit = screen.getByRole('button', { name: 'Update password' });

    await user.type(
      screen.getByLabelText('New password'),
      DEFAULT_GRADE_PASSWORD,
    );
    await user.type(
      screen.getByLabelText('Confirm new password'),
      DEFAULT_GRADE_PASSWORD,
    );
    expect(
      await screen.findByRole('listitem', {
        name: 'At least 20 characters: invalid',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('At least 12 characters'),
    ).not.toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText('New password'));
    await user.type(
      screen.getByLabelText('New password'),
      STRICT_GRADE_PASSWORD,
    );
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(
      screen.getByLabelText('Confirm new password'),
      STRICT_GRADE_PASSWORD,
    );
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard/$id',
        params: { id: 'org-1' },
        replace: true,
      }),
    );
    expect(
      paths.filter((path) => path.startsWith('/api/app/governance/')),
    ).toEqual([]);
  });

  it('lets the server decide when the policy cannot be read, and keeps its refusal on the field', async () => {
    stubBackend({
      policy: 'missing',
      write: json({ error: 'password_policy_violation' }, 400),
    });
    const { user } = renderPage();

    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Update password' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(
      await screen.findByText(
        "This password doesn't meet your organization's password policy.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '/dashboard/$id' }),
    );
  });
});
