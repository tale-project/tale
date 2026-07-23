import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import enMessages from '@/messages/en.yml';
import { render } from '@/tests/utils/render';

// Router: `useSearch` drives the SSO-error params under test; `useNavigate`
// records the "clear error" retry navigation. Real i18n is intentionally NOT
// mocked here (the idle-notice test mocks it) so we can assert the mapped
// English message actually renders, not the raw key.
const { mockNavigate, mockSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { value: {} as Record<string, unknown> },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: null }),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch.value,
}));

vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasAnyUsers: () => ({ data: true, isLoading: false }),
  useIsSsoConfigured: () => ({ data: { enabled: true } }),
  useSsoSelectableOrgs: () => ({ data: [] }),
}));

vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

import { LogInPage } from '@/app/routes/_auth/log-in';

const ssoMessages = enMessages.auth.sso;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.__ENV__;
});

beforeEach(() => {
  mockSearch.value = {};
});

describe('LogInPage – SSO failure is surfaced (A2.1)', () => {
  it('renders the mapped message for a redirect-mismatch (AADSTS50011)', () => {
    mockSearch.value = {
      error: 'sso.errors.redirectMismatch',
      error_code: 'AADSTS50011',
    };

    render(<LogInPage />);

    // The mapped, human-readable reason renders — not a blank form, not the raw
    // translation key.
    expect(
      screen.getByText(ssoMessages.errors.redirectMismatch),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('sso.errors.redirectMismatch'),
    ).not.toBeInTheDocument();
    // A non-conditional-access failure renders the standard alert (no recovery
    // button), and the credential form still renders below it.
    expect(
      screen.queryByRole('button', { name: ssoMessages.actions.tryAgain }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: enMessages.auth.login.loginButton }),
    ).toBeInTheDocument();
  });

  it('renders a plain-text fallback error verbatim (unmapped failure)', () => {
    mockSearch.value = { error: 'SSO login failed: unexpected_error' };

    render(<LogInPage />);

    expect(
      screen.getByText('SSO login failed: unexpected_error'),
    ).toBeInTheDocument();
  });

  it('renders the recovery hint when provided', () => {
    mockSearch.value = {
      error: 'sso.errors.userNotAssigned',
      error_code: 'AADSTS50105',
      recovery: 'sso.errors.recovery.contactAdmin',
    };

    render(<LogInPage />);

    expect(
      screen.getByText(ssoMessages.errors.userNotAssigned),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ssoMessages.errors.recovery.contactAdmin),
    ).toBeInTheDocument();
  });

  it('uses the ConditionalAccessError UI for a conditional-access code (AADSTS53003)', () => {
    mockSearch.value = {
      error: 'sso.errors.conditionalAccessBlocked',
      error_code: 'AADSTS53003',
      recovery: 'sso.errors.recovery.contactAdmin',
    };

    render(<LogInPage />);

    // The conditional-access component renders the blocked message + the
    // "contact your administrator" affordance (its blocked-error branch), and
    // NOT the generic "Try again" button.
    expect(
      screen.getByText(ssoMessages.errors.conditionalAccessBlocked),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ssoMessages.actions.contactAdminMessage),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: ssoMessages.actions.tryAgain }),
    ).not.toBeInTheDocument();
  });

  it('offers a retry that strips the error params for an MFA code (AADSTS50076)', async () => {
    mockSearch.value = {
      error: 'sso.errors.mfaRequired',
      error_code: 'AADSTS50076',
      recovery: 'sso.errors.recovery.completeMfa',
    };

    const { user } = render(<LogInPage />);

    // MFA is a conditional-access code → the recovery UI offers "complete MFA".
    const retry = screen.getByRole('button', {
      name: ssoMessages.actions.completeMfa,
    });
    await user.click(retry);

    // The retry navigates back to a clean login page (error params dropped).
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const arg = mockNavigate.mock.calls[0][0];
    expect(arg.to).toBe('/log-in');
    const cleared = arg.search({ error: 'x', error_code: 'y', recovery: 'z' });
    expect(cleared.error).toBeUndefined();
    expect(cleared.error_code).toBeUndefined();
    expect(cleared.recovery).toBeUndefined();
  });

  it('shows no SSO error block on a clean login page', () => {
    render(<LogInPage />);

    expect(
      screen.queryByText(ssoMessages.errors.redirectMismatch),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
