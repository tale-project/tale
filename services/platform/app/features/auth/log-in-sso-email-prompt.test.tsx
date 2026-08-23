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
vi.mock('@/lib/i18n/client', () => ({
  useT: (_ns: string) => ({ t: (key: string) => key }),
}));

// ── SEO util ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

// ── Auth queries: a multi-connection deployment ──────────────────────────────
const { mockSelectableOrgs } = vi.hoisted(() => ({
  mockSelectableOrgs: { value: [] as Record<string, string>[] },
}));
vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasAnyUsers: () => ({ data: true, isLoading: false }),
  useIsSsoConfigured: () => ({
    data: { enabled: true, providerType: 'entra-id', multiple: true },
  }),
  useSsoSelectableOrgs: () => ({ data: mockSelectableOrgs.value }),
}));

// ── React Query client / toast / auth client ────────────────────────────────
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

// ── Component (imported after all vi.mock calls) ─────────────────────────────
import { LogInPage } from '@/app/routes/_auth/log-in';

const locationAssign = vi.fn();

beforeEach(() => {
  mockSearch.value = {};
  mockSelectableOrgs.value = [];
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
  });
});
