import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  consent: vi.fn(),
  continue: vi.fn(),
  publicClient: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: auth.getSession, oauth2: auth },
}));
vi.mock('@/app/lib/backend/api-client', () => ({
  backendFetch: () => Promise.resolve({ authenticated: true, decision: 'ok' }),
}));
vi.mock('@/app/components/ui/logo/logo-link', () => ({
  LogoLink: () => <a href="/">Tale</a>,
}));

import { OAuthAuthorization } from './oauth-authorization';

const navigate = vi.fn();
const signedQuery =
  'client_id=reviewed&ba_param=state&ba_param=nonce&sig=bytes%2B';

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({
    data: { user: { email: 'staff@example.test' } },
  });
  auth.publicClient.mockResolvedValue({
    data: { client_name: 'Office application' },
  });
  // The maintained client's redirect plugin already follows this response.
  // A second navigation would consume the callback's one-use state twice.
  auth.consent.mockResolvedValue({
    data: { redirect: true, url: 'https://office.example.test/callback' },
  });
  auth.continue.mockResolvedValue({
    data: { redirect: true, url: '/oauth/consent' },
  });
  const originalWindow = window;
  vi.stubGlobal(
    'window',
    new Proxy(originalWindow, {
      get(target, key) {
        if (key === 'location')
          return { search: `?${signedQuery}`, assign: navigate };
        return Reflect.get(target, key, target);
      },
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('native identity consent', () => {
  it.each([
    ['Allow and continue', true],
    ['Cancel', false],
  ] as const)(
    'submits %s once and leaves navigation to the maintained auth client',
    async (label, accept) => {
      const { user, container } = render(<OAuthAuthorization consent />);
      const action = await screen.findByRole('button', { name: label });
      await waitFor(() => expect(action).toBeEnabled());
      expect(screen.getByText('staff@example.test')).toBeVisible();
      await checkAccessibility(container);
      await user.click(action);
      expect(auth.consent).toHaveBeenCalledExactlyOnceWith({
        accept,
        oauth_query: signedQuery,
      });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('resumes a signed authorization only once under StrictMode', async () => {
    render(
      <StrictMode>
        <OAuthAuthorization consent={false} />
      </StrictMode>,
    );
    await waitFor(() => expect(auth.continue).toHaveBeenCalledTimes(1));
    expect(auth.continue).toHaveBeenCalledWith({
      postLogin: true,
      oauth_query: signedQuery,
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
