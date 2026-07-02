import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// On a deployment where several orgs enable SSO, the organization email is the
// routing key. Clicking "Continue with SSO" must step into the dedicated SSO
// screen (`?method=sso`) that asks for it — an SSO user never touches the
// credential form, and no request leaves the page until the email routes.

// ── Router ───────────────────────────────────────────────────────────────────
const { mockNavigate, mockSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { value: {} as Record<string, unknown> },
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

const mockFetch = vi.fn();

beforeEach(() => {
  mockSearch.value = {};
  mockSelectableOrgs.value = [];
  vi.stubGlobal('fetch', mockFetch);
  // `redirectToSso` reads SITE_URL via getEnv, which throws when the runtime
  // env bridge is absent — provide it like the real page load does.
  window.__ENV__ = {
    SITE_URL: 'http://localhost:3000',
    BASE_PATH: '',
  } as Window['__ENV__'];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete window.__ENV__;
});

describe('LogInPage – multi-connection SSO steps into the dedicated email screen', () => {
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
    // No discovery round-trip, no IdP redirect from the credential screen.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('renders only the SSO email step under ?method=sso (no credential form)', () => {
    mockSearch.value = { method: 'sso' };

    render(<LogInPage />);

    expect(screen.getByText('login.ssoDescription')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'login.continueWithSso' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'login.ssoBackToLogin' }),
    ).toBeInTheDocument();
    // The password login is a different method — it must not render here.
    expect(screen.queryByLabelText(/^password\b/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'login.loginButton' }),
    ).not.toBeInTheDocument();
  });

  it('asks for the email when continuing with an empty field', async () => {
    mockSearch.value = { method: 'sso' };
    const { user } = render(<LogInPage />);

    await user.click(
      screen.getByRole('button', { name: 'login.continueWithSso' }),
    );

    await waitFor(() => {
      expect(screen.getByText('login.ssoEmailRequired')).toBeInTheDocument();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('says when no connection matches the typed email domain', async () => {
    mockSearch.value = { method: 'sso' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ssoEnabled: false }), { status: 200 }),
    );
    const { user } = render(<LogInPage />);

    await user.type(
      screen.getByLabelText('email', { exact: false }),
      'someone@unrouted.example',
    );
    await user.click(
      screen.getByRole('button', { name: 'login.continueWithSso' }),
    );

    await waitFor(() => {
      expect(screen.getByText('login.ssoEmailNoMatch')).toBeInTheDocument();
    });
    // Discovery ran once; the authorize redirect did not happen.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clears the hint as soon as the email is edited', async () => {
    mockSearch.value = { method: 'sso' };
    const { user } = render(<LogInPage />);

    await user.click(
      screen.getByRole('button', { name: 'login.continueWithSso' }),
    );
    await waitFor(() => {
      expect(screen.getByText('login.ssoEmailRequired')).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText('email', { exact: false }),
      'member@a.example',
    );

    await waitFor(() => {
      expect(
        screen.queryByText('login.ssoEmailRequired'),
      ).not.toBeInTheDocument();
    });
  });

  it('lists domain-less connections for manual selection', () => {
    mockSearch.value = { method: 'sso' };
    mockSelectableOrgs.value = [
      { organizationId: 'org_x', displayName: 'Org X SSO', protocol: 'oidc' },
      { organizationId: 'org_y', displayName: 'Org Y SSO', protocol: 'saml' },
    ];

    render(<LogInPage />);

    expect(screen.getByText('login.ssoPickOrganization')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Org X SSO' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Org Y SSO' }),
    ).toBeInTheDocument();
  });

  it('hides the picker when every connection has an email domain', () => {
    mockSearch.value = { method: 'sso' };

    render(<LogInPage />);

    expect(
      screen.queryByText('login.ssoPickOrganization'),
    ).not.toBeInTheDocument();
  });

  it('the back button returns to the credential screen', async () => {
    mockSearch.value = { method: 'sso' };
    const { user } = render(<LogInPage />);

    await user.click(
      screen.getByRole('button', { name: 'login.ssoBackToLogin' }),
    );

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/log-in');
    expect(call.search({ method: 'sso' })).toMatchObject({
      method: undefined,
    });
  });
});
