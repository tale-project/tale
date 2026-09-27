import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  session: { isAuthenticated: true, isLoading: false },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  Outlet: () => null,
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession, $store: { notify: vi.fn() } },
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => h.session,
}));
vi.mock('@/app/hooks/use-session-idle-watchdog', () => ({
  useSessionIdleWatchdog: () => undefined,
}));
vi.mock('@/app/components/layout/dashboard-shell-frame', () => ({
  DashboardShellFrame: () => null,
}));
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => ({ authenticated: true, decision: 'allowed' }),
}));
vi.mock('@/app/context/account-bootstrap-provider', () => ({
  AccountBootstrapProvider: ({ children }: { children: ReactNode }) => children,
}));

import { reportSessionLapsed } from '@/app/lib/auth/session-lapse';

import { Route } from './dashboard';

const realLocation = window.location;
/** jsdom cannot navigate; the dashboard leaves by a full load, so the
 * assignment is what is observed. */
let page: { href: string; pathname: string; search: string; hash: string };

const HERE = encodeURIComponent('/dashboard/org-1/products');

function renderDashboard() {
  const Dashboard = (Route as unknown as { component: () => ReactNode })
    .component;
  return render(<Dashboard />);
}

beforeEach(() => {
  h.getSession.mockReset();
  page = {
    href: 'http://localhost/dashboard/org-1/products',
    pathname: '/dashboard/org-1/products',
    search: '',
    hash: '',
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: page,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('the dashboard after a session ends', () => {
  it('takes a signed-in tab to sign-in on a lapsed-session answer, saying why', async () => {
    h.session = { isAuthenticated: true, isLoading: false };
    h.getSession.mockResolvedValue({ data: null, error: null });
    renderDashboard();
    expect(h.getSession).not.toHaveBeenCalled();

    act(() => {
      reportSessionLapsed();
    });

    await waitFor(() =>
      expect(page.href).toBe(`/log-in?redirectTo=${HERE}&reason=session-ended`),
    );
  });

  // The probe's own lane is unchanged: it re-checks and redirects without a
  // reason, and a lapsed-session answer does not start a second re-check.
  it('keeps its own re-check when its probe finds nobody signed in', async () => {
    h.session = { isAuthenticated: false, isLoading: false };
    h.getSession.mockResolvedValue({ data: null, error: null });
    renderDashboard();

    act(() => {
      reportSessionLapsed();
    });

    await waitFor(() => expect(page.href).toBe(`/log-in?redirectTo=${HERE}`));
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });
});
