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
const navigateWithinApp = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateWithinApp,
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: auth.getSession, oauth2: auth },
}));
vi.mock('@/app/lib/backend/api-client', () => ({
  backendFetch: () => Promise.resolve({ authenticated: true, decision: 'ok' }),
}));
vi.mock('@/app/components/logo/logo-link', () => ({
  LogoLink: () => <a href="/">Tale</a>,
}));
// A coding agent's request has a page of its own (tested beside it).
vi.mock('./agent-consent/agent-consent', () => ({
  AgentConsent: ({ email }: { email: string }) => (
    <p>The page for a coding agent, signed in as {email}</p>
  ),
}));

import { OAuthAuthorization } from './oauth-authorization';

const navigate = vi.fn();
const signedQuery =
  'client_id=reviewed&ba_param=state&ba_param=nonce&sig=bytes%2B';
/** What the address of the page says, as the browser has it. */
let search = `?${signedQuery}`;

beforeEach(() => {
  vi.clearAllMocks();
  search = `?${signedQuery}`;
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
          return {
            origin: 'https://identity.example.test',
            pathname: '/oauth/continue',
            search,
            assign: navigate,
            replace: navigate,
          };
        return Reflect.get(target, key, target);
      },
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('native identity consent', () => {
  it('opens login in the current document and preserves the signed query bytes', async () => {
    auth.getSession.mockResolvedValue({ data: null });
    render(<OAuthAuthorization consent={false} />);

    await waitFor(() =>
      expect(navigateWithinApp).toHaveBeenCalledExactlyOnceWith({
        to: '/log-in',
        search: { redirectTo: `/oauth/continue?${signedQuery}` },
        replace: true,
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.continue).not.toHaveBeenCalled();
  });

  it.each([
    ['Allow and continue', true],
    ['Cancel', false],
  ] as const)(
    'submits %s once and leaves navigation to the maintained auth client',
    async (label, accept) => {
      const { user, container } = render(<OAuthAuthorization consent />);
      expect(
        await screen.findByText(
          'Office application wants to sign you in with Tale.',
        ),
      ).toBeVisible();
      expect(screen.getByText('staff@example.test')).toBeVisible();
      const action = screen.getByRole('button', { name: label });
      expect(action).toBeEnabled();
      await checkAccessibility(container);
      await user.click(action);
      expect(auth.consent).toHaveBeenCalledExactlyOnceWith({
        accept,
        oauth_query: signedQuery,
      });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  describe('when the application asking cannot be read', () => {
    it.each([
      ['answers with an error', { error: { message: 'Unavailable' } }],
      ['names no application', { data: {} }],
    ])(
      'refuses to allow and still lets the person say no when the lookup %s',
      async (_case, answer) => {
        auth.publicClient.mockResolvedValue(answer);
        const { user, container } = render(<OAuthAuthorization consent />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'This sign-in request could not continue',
        );
        expect(
          screen.queryByRole('button', { name: 'Allow and continue' }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
        await checkAccessibility(container);

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(auth.consent).toHaveBeenCalledExactlyOnceWith({
          accept: false,
          oauth_query: signedQuery,
        });
        expect(navigate).not.toHaveBeenCalled();
      },
    );

    it('does the same when the lookup cannot be reached', async () => {
      auth.publicClient.mockRejectedValue(new Error('offline'));
      const { user } = render(<OAuthAuthorization consent />);

      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(auth.consent).toHaveBeenCalledExactlyOnceWith({
        accept: false,
        oauth_query: signedQuery,
      });
    });

    it('reads the application again on Try again and then offers to allow', async () => {
      auth.publicClient.mockResolvedValueOnce({
        error: { message: 'Unavailable' },
      });
      const { user } = render(<OAuthAuthorization consent />);

      await user.click(
        await screen.findByRole('button', { name: 'Try again' }),
      );

      expect(
        await screen.findByText(
          'Office application wants to sign you in with Tale.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Allow and continue' }),
      ).toBeEnabled();
      expect(auth.publicClient).toHaveBeenCalledTimes(2);
      expect(auth.getSession).toHaveBeenCalledTimes(2);
      expect(auth.consent).not.toHaveBeenCalled();
    });

    it('reads the sign-in again too when that was what failed', async () => {
      auth.getSession.mockResolvedValueOnce({ error: { message: 'offline' } });
      const { user } = render(<OAuthAuthorization consent />);

      await user.click(
        await screen.findByRole('button', { name: 'Try again' }),
      );

      expect(
        await screen.findByRole('button', { name: 'Allow and continue' }),
      ).toBeEnabled();
      expect(screen.getByText('staff@example.test')).toBeVisible();
    });

    it('lets the person say no while the application is still being read, and never allow', async () => {
      auth.publicClient.mockReturnValue(new Promise(() => {}));
      const { user } = render(<OAuthAuthorization consent />);

      expect(
        await screen.findByRole('button', { name: 'Allow and continue' }),
      ).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(auth.consent).toHaveBeenCalledExactlyOnceWith({
        accept: false,
        oauth_query: signedQuery,
      });
    });
  });

  it('keeps Allow and Cancel for a known application when sending the answer fails', async () => {
    auth.consent.mockResolvedValue({ error: { message: 'Refused' } });
    const { user } = render(<OAuthAuthorization consent />);
    await screen.findByText(
      'Office application wants to sign you in with Tale.',
    );

    await user.click(
      screen.getByRole('button', { name: 'Allow and continue' }),
    );

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Allow and continue' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('continues again on Try again after the provider refused to continue', async () => {
    auth.continue.mockResolvedValueOnce({ error: { message: 'Refused' } });
    const { user } = render(<OAuthAuthorization consent={false} />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(auth.continue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reads the sign-in again on Try again when it could not be read before continuing', async () => {
    auth.getSession.mockResolvedValueOnce({ error: { message: 'offline' } });
    const { user } = render(<OAuthAuthorization consent={false} />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(auth.continue).toHaveBeenCalledTimes(1));
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });

  it('leaves a coding agent’s request to the page made for it, asking the provider nothing about the app', async () => {
    search = `?client_id=agent&scope=tale%3Amcp+offline_access&sig=bytes%2B`;
    render(<OAuthAuthorization consent />);
    expect(
      await screen.findByText(
        'The page for a coding agent, signed in as staff@example.test',
      ),
    ).toBeVisible();
    expect(auth.publicClient).not.toHaveBeenCalled();
    expect(auth.consent).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Allow and continue' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a single sign-on that asks for no agent access on the identity page', async () => {
    search = `?client_id=reviewed&scope=openid+profile+email&sig=bytes%2B`;
    render(<OAuthAuthorization consent />);
    expect(
      await screen.findByRole('button', { name: 'Allow and continue' }),
    ).toBeVisible();
    expect(auth.publicClient).toHaveBeenCalledTimes(1);
  });

  it('still resumes a coding agent’s request after sign-in before it is shown the page', async () => {
    search = `?client_id=agent&scope=tale%3Amcp&sig=bytes%2B`;
    render(<OAuthAuthorization consent={false} />);
    await waitFor(() => expect(auth.continue).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/The page for a coding agent/),
    ).not.toBeInTheDocument();
  });

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
