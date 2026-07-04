import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { AuthSsoBackButton } from '@/app/features/auth/components/auth-sso-back-button';

beforeEach(() => {
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthSsoBackButton', () => {
  it('returns to the credential login screen', async () => {
    const { user } = render(<AuthSsoBackButton />);

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
