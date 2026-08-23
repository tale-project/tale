import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// ── Router ───────────────────────────────────────────────────────────────────
const { mockNavigate, mockSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSearch: { value: {} },
}));
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
vi.mock('@/lib/i18n/client', () => ({
  useT: (_ns: string) => ({ t: (key: string) => key }),
}));

// ── SEO util ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

// ── Auth queries ─────────────────────────────────────────────────────────────
vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasAnyUsers: () => ({ data: true, isLoading: false }),
  useIsSsoConfigured: () => ({ data: { enabled: false } }),
  useSsoSelectableOrgs: () => ({ data: [] }),
}));

// ── React Query client ───────────────────────────────────────────────────────
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Toast ────────────────────────────────────────────────────────────────────
vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// ── Auth client ──────────────────────────────────────────────────────────────
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn() },
  },
}));

// ── Component (imported after all vi.mock calls) ──────────────────────────────
import { LogInPage } from '@/app/routes/_auth/log-in';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.__ENV__;
});

beforeEach(() => {
  mockSearch.value = { redirectTo: undefined };
});

describe('LogInPage – signed-out-for-inactivity notice (#1502)', () => {
  it('renders the inactivity notice above the form when reason=idle', () => {
    mockSearch.value = { reason: 'idle' };

    render(<LogInPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'sessionIdle.signedOutNotice',
    );
    // The regular credential form stays available.
    expect(
      screen.getByRole('button', { name: 'login.loginButton' }),
    ).toBeInTheDocument();
  });

  it('shows no notice without the reason param', () => {
    render(<LogInPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('holds the trusted-headers auto-redirect behind an explicit continue after an idle sign-out', () => {
    mockSearch.value = { reason: 'idle' };
    window.__ENV__ = {
      TRUSTED_HEADERS_ENABLED: true,
      SITE_URL: 'http://localhost',
      BASE_PATH: '',
    };

    render(<LogInPage />);

    // The notice and the click-through render instead of a silent re-auth.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'sessionIdle.signedOutNotice',
    );
    expect(
      screen.getByRole('button', { name: 'sessionIdle.continueToSignIn' }),
    ).toBeInTheDocument();
    // No credential form in trusted-headers mode — the proxy owns auth.
    expect(
      screen.queryByRole('button', { name: 'login.loginButton' }),
    ).not.toBeInTheDocument();
  });
});
