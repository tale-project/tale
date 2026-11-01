import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// On a deployment where several orgs enable SSO, clicking "Continue with SSO"
// steps into the org-picker screen (`?method=sso`) — no email field, no discover
// round-trip until the user picks an organization.

// ── Router ───────────────────────────────────────────────────────────────────
const { mockNavigate, mockSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { value: {} },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: null }),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch.value,
}));

// ── i18n (identity: assertions target the raw keys) ─────────────────────────
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (_ns: string) => ({ t: (key: string) => key }),
}));

// ── SEO util ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

// ── Auth queries: a multi-connection deployment ──────────────────────────────
// The org list's read as react-query reports it: `value` is `data`, and the
// rest is what `readStateOf` reads to tell pending, failed and answered apart.
const { mockSelectableOrgs } = vi.hoisted(() => ({
  mockSelectableOrgs: {
    value: [] as Record<string, string>[] | undefined,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: vi.fn(),
  },
}));
vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasAnyUsers: () => ({ data: true, isLoading: false }),
  useIsSsoConfigured: () => ({
    data: { enabled: true, providerType: 'entra-id', multiple: true },
  }),
  useSsoSelectableOrgs: () => ({
    data: mockSelectableOrgs.value,
    isError: mockSelectableOrgs.isError,
    isFetching: mockSelectableOrgs.isFetching,
    errorUpdateCount: mockSelectableOrgs.errorUpdateCount,
    refetch: mockSelectableOrgs.refetch,
  }),
  useTrustedHeadersHandoff: () => ({ data: false, isLoading: false }),
}));

// ── React Query client / toast / auth client ────────────────────────────────
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

// ── Component (imported after all vi.mock calls) ─────────────────────────────
import { LogInPage } from '@/app/routes/_auth/log-in';

const locationAssign = vi.fn();

beforeEach(() => {
  mockSearch.value = {};
  mockSelectableOrgs.value = [];
  mockSelectableOrgs.isError = false;
  mockSelectableOrgs.isFetching = false;
  mockSelectableOrgs.errorUpdateCount = 0;
  locationAssign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost/',
      assign: locationAssign,
    },
  });
  window.__ENV__ = {
    SITE_URL: 'http://localhost:3000',
    BASE_PATH: '',
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete window.__ENV__;
});

describe('LogInPage – multi-connection SSO org picker', () => {
  it('clicking the SSO button navigates to ?method=sso instead of redirecting', async () => {
    const { user } = render(<LogInPage />);

    await user.click(
      screen.getByRole('button', { name: 'login.continueWithSso' }),
    );

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/log-in');
    expect(call.search({})).toMatchObject({ method: 'sso' });
  });

  it('renders the org picker under ?method=sso (no credential or email form)', () => {
    mockSearch.value = { method: 'sso' };
    mockSelectableOrgs.value = [
      { organizationId: 'org_x', displayName: 'Org X SSO', protocol: 'oidc' },
    ];

    render(<LogInPage />);

    expect(screen.getByText('login.ssoDescription')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Org X SSO/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email\b/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'login.continueWithSso' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'login.loginButton' }),
    ).not.toBeInTheDocument();
  });

  it('lists every enabled connection, including those with an email domain', () => {
    mockSearch.value = { method: 'sso' };
    mockSelectableOrgs.value = [
      { organizationId: 'org_x', displayName: 'Org X SSO', protocol: 'oidc' },
      { organizationId: 'org_y', displayName: 'Org Y SSO', protocol: 'saml' },
    ];

    render(<LogInPage />);

    expect(
      screen.getByRole('option', { name: /Org X SSO/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Org Y SSO/ }),
    ).toBeInTheDocument();
  });

  it('redirects to the IdP with organizationId pinned when an org is picked', async () => {
    mockSearch.value = { method: 'sso' };
    mockSelectableOrgs.value = [
      { organizationId: 'org_x', displayName: 'Org X SSO', protocol: 'oidc' },
    ];
    const { user } = render(<LogInPage />);

    await user.click(screen.getByRole('option', { name: /Org X SSO/ }));

    expect(window.location.href).toContain('/api/sso/authorize');
    expect(window.location.href).toContain('organizationId=org_x');
  });

  it('shows a message when no organizations are available', () => {
    mockSearch.value = { method: 'sso' };

    render(<LogInPage />);

    expect(screen.getByText('login.ssoNoOrganizations')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'actions.tryAgain' }),
    ).not.toBeInTheDocument();
  });
});

// Only an answer says which organizations offer SSO: a list that is still
// loading or failed to load never reads as "none available" (#4606).
describe('LogInPage – the SSO step before the org list answers', () => {
  beforeEach(() => {
    mockSearch.value = { method: 'sso' };
  });

  it('masks the picker while the list is loading, with no alert', () => {
    mockSelectableOrgs.value = undefined;
    mockSelectableOrgs.isFetching = true;

    render(<LogInPage />);

    expect(
      screen.queryByText('login.ssoNoOrganizations'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    // The placeholder rows take no pick.
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('inert');
    }
  });

  it('names a failed list and offers Try again, which reads it again', async () => {
    mockSelectableOrgs.value = undefined;
    mockSelectableOrgs.isError = true;
    mockSelectableOrgs.errorUpdateCount = 1;

    const { user } = render(<LogInPage />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('login.ssoOrganizationsFailed');
    expect(alert).not.toHaveTextContent('login.ssoNoOrganizations');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'actions.tryAgain' }));

    expect(mockSelectableOrgs.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the failure up, with Try again busy, while the retry runs', () => {
    // react-query puts a read that never answered back to pending, with no
    // error, the moment a retry starts.
    mockSelectableOrgs.value = undefined;
    mockSelectableOrgs.isFetching = true;
    mockSelectableOrgs.errorUpdateCount = 1;

    render(<LogInPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'login.ssoOrganizationsFailed',
    );
    expect(
      screen.getByRole('button', { name: 'actions.tryAgain' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.queryByText('login.ssoNoOrganizations'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps offering the list it had when a refresh fails', () => {
    mockSelectableOrgs.value = [
      { organizationId: 'org_x', displayName: 'Org X SSO', protocol: 'oidc' },
    ];
    mockSelectableOrgs.isError = true;
    mockSelectableOrgs.errorUpdateCount = 1;

    render(<LogInPage />);

    expect(
      screen.getByRole('option', { name: /Org X SSO/ }),
    ).not.toHaveAttribute('inert');
    expect(
      screen.queryByText('login.ssoNoOrganizations'),
    ).not.toBeInTheDocument();
  });
});
