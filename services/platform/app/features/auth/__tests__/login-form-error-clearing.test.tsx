import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils/render';

// ── Router ───────────────────────────────────────────────────────────────────
const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: null }),
  useNavigate: () => mockNavigate,
  useSearch: () => ({ redirectTo: undefined }),
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
}));

// ── React Query client ───────────────────────────────────────────────────────
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Toast ────────────────────────────────────────────────────────────────────
vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// ── Auth client ──────────────────────────────────────────────────────────────
const { mockSignInEmail } = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: mockSignInEmail },
  },
}));

// ── Component (imported after all vi.mock calls) ──────────────────────────────
import { LogInPage } from '@/app/routes/_auth/log-in';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default: successful sign-in (no error path triggered)
  mockSignInEmail.mockResolvedValue({ data: { user: { id: '1' } } });
});

describe('LogInPage – submit button state after failed login (#648)', () => {
  it('disables submit button when form is empty', () => {
    render(<LogInPage />);
    expect(
      screen.getByRole('button', { name: 'login.loginButton' }),
    ).toBeDisabled();
  });

  it('enables submit button when both fields are filled', async () => {
    const { user } = render(<LogInPage />);

    await user.type(screen.getByLabelText('email'), 'user@example.com');
    await user.type(screen.getByLabelText('password'), 'secret');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'login.loginButton' }),
      ).not.toBeDisabled();
    });
  });

  it('re-enables submit button after editing email following a failed login', async () => {
    // Simulate a failed login: onError callback fires, no user in response
    mockSignInEmail.mockImplementation(async (_payload, { onError }) => {
      onError?.();
      return { data: null };
    });

    const { user } = render(<LogInPage />);

    await user.type(screen.getByLabelText('email'), 'wrong@example.com');
    await user.type(screen.getByLabelText('password'), 'wrongpassword');

    await user.click(screen.getByRole('button', { name: 'login.loginButton' }));

    // Error message should appear on the password field
    await waitFor(() => {
      expect(screen.getByText('login.wrongCredentials')).toBeInTheDocument();
    });

    // User edits the email field — onChange clears the password error
    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'correct@example.com' },
    });

    await waitFor(() => {
      expect(
        screen.queryByText('login.wrongCredentials'),
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'login.loginButton' }),
    ).not.toBeDisabled();
  });

  it('re-enables submit button after editing password following a failed login', async () => {
    mockSignInEmail.mockImplementation(async (_payload, { onError }) => {
      onError?.();
      return { data: null };
    });

    const { user } = render(<LogInPage />);

    await user.type(screen.getByLabelText('email'), 'wrong@example.com');
    await user.type(screen.getByLabelText('password'), 'wrongpassword');

    await user.click(screen.getByRole('button', { name: 'login.loginButton' }));

    await waitFor(() => {
      expect(screen.getByText('login.wrongCredentials')).toBeInTheDocument();
    });

    // User corrects the password
    fireEvent.change(screen.getByLabelText('password'), {
      target: { value: 'correctpassword' },
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'login.loginButton' }),
      ).not.toBeDisabled();
    });
  });

  it('clears the error message when the user resubmits', async () => {
    let callCount = 0;
    mockSignInEmail.mockImplementation(async (_payload, { onError }) => {
      callCount++;
      if (callCount === 1) {
        onError?.();
        return { data: null };
      }
      return { data: { user: { id: '1' } } };
    });

    const { user } = render(<LogInPage />);

    await user.type(screen.getByLabelText('email'), 'user@example.com');
    await user.type(screen.getByLabelText('password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'login.loginButton' }));

    await waitFor(() => {
      expect(screen.getByText('login.wrongCredentials')).toBeInTheDocument();
    });

    // Re-submit — error should be cleared before the request fires
    await user.click(screen.getByRole('button', { name: 'login.loginButton' }));

    // After a successful second attempt the error is gone
    await waitFor(() => {
      expect(
        screen.queryByText('login.wrongCredentials'),
      ).not.toBeInTheDocument();
    });
  });
});
