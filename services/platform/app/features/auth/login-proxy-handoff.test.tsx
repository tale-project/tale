import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

/**
 * The login page's hand-off to an application's authenticating proxy: when
 * the backend saw the proxy's headers on the request, the page sends the
 * browser to the trusted-headers door instead of showing the form — and
 * never loops when it comes straight back.
 */

// ── Router ───────────────────────────────────────────────────────────────────
const { mockNavigate, mockSearch, mockHandoff, mockHasUsers } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(),
    mockSearch: { value: {} as Record<string, unknown> },
    mockHandoff: {
      value: { data: false as boolean | undefined, isLoading: false },
    },
    mockHasUsers: {
      value: { data: true as boolean | undefined, isLoading: false },
    },
  }),
);
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: null }),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch.value,
  Link: ({ children, ...props }: Record<string, unknown>) => {
    const { createElement } = require('react');
    return createElement('a', props, children);
  },
}));

// ── i18n ─────────────────────────────────────────────────────────────────────
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (_ns: string) => ({ t: (key: string) => key }),
}));

// ── SEO util ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

// ── Auth queries ─────────────────────────────────────────────────────────────
vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasAnyUsers: () => mockHasUsers.value,
  useIsSsoConfigured: () => ({ data: { enabled: false } }),
  useSsoSelectableOrgs: () => ({ data: [] }),
  useTrustedHeadersHandoff: () => mockHandoff.value,
}));

// ── React Query client ───────────────────────────────────────────────────────
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Toast ────────────────────────────────────────────────────────────────────
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

// ── Auth client ──────────────────────────────────────────────────────────────
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn() },
  },
}));

// ── Component (imported after all vi.mock calls) ──────────────────────────────
import { markProxyHandoffAttempt } from '@/app/features/auth/lib/proxy-handoff';
import { LogInPage } from '@/app/routes/_auth/log-in';

const locationAssign = vi.fn();
// Same-origin, never SITE_URL: the browser must stay on the host it is on —
// that is where the proxy that injects the key sits.
const DOOR = '/api/trusted-headers/authenticate';
const doorFor = (path: string) =>
  `${DOOR}?redirect=${encodeURIComponent(path)}`;

beforeEach(() => {
  mockSearch.value = {};
  mockHandoff.value = { data: true, isLoading: false };
  mockHasUsers.value = { data: true, isLoading: false };
  locationAssign.mockReset();
  mockNavigate.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost/log-in',
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
  delete window.__ENV__;
});

describe('LogInPage – hand-off to an authenticating proxy', () => {
  it('sends the browser to the door with the validated return path and shows no form', () => {
    mockSearch.value = { redirectTo: '/dashboard/projects' };

    render(<LogInPage />);

    expect(locationAssign).toHaveBeenCalledWith(doorFor('/dashboard/projects'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'login.proxyHandoff.pending',
    );
    expect(
      screen.queryByRole('button', { name: 'login.loginButton' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to the dashboard when the return path is not a same-origin path', () => {
    mockSearch.value = { redirectTo: 'https://evil.example/' };

    render(<LogInPage />);

    expect(locationAssign).toHaveBeenCalledWith(doorFor('/dashboard'));
  });

  it('stays on the form when the request did not come through a proxy', () => {
    mockHandoff.value = { data: false, isLoading: false };

    render(<LogInPage />);

    expect(locationAssign).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'login.loginButton' }),
    ).toBeInTheDocument();
  });

  it('does not loop: straight back from the door it shows the form, the notice and a retry', () => {
    markProxyHandoffAttempt(Date.now() - 5_000);

    render(<LogInPage />);

    expect(locationAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'login.proxyHandoff.stalled',
    );
    expect(
      screen.getByRole('button', { name: 'login.loginButton' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'login.proxyHandoff.retry' }),
    );
    expect(locationAssign).toHaveBeenCalledWith(doorFor('/dashboard'));
  });

  it('forgets a hand-off older than a minute', () => {
    markProxyHandoffAttempt(Date.now() - 61_000);

    render(<LogInPage />);

    expect(locationAssign).toHaveBeenCalledTimes(1);
  });

  it('holds the hand-off behind Continue after an inactivity sign-out (#1502)', () => {
    mockSearch.value = { reason: 'idle' };

    render(<LogInPage />);

    expect(locationAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'sessionIdle.signedOutNotice',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'login.proxyHandoff.continue' }),
    );
    expect(locationAssign).toHaveBeenCalledWith(doorFor('/dashboard'));
  });

  it('lets setup win on a fresh deployment', () => {
    mockHasUsers.value = { data: false, isLoading: false };

    render(<LogInPage />);

    expect(locationAssign).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/setup' });
  });
});
