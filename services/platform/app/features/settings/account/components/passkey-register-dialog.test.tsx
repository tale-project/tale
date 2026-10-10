// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

// Registering a passkey needs a session signed in within a day. Someone who
// stayed signed in longer — everyone the post-grace 2FA wall catches — used
// to meet a bare "Session is not fresh" with no way forward. The dialog now
// asks for the password first and only then for the passkey.

const HOUR = 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  session: { createdAt: new Date() as Date | undefined },
  status: { value: { authenticated: true, hasCredential: true } as unknown },
  addPasskey: vi.fn(),
  reauthenticate: vi.fn(),
  signOut: vi.fn(),
  redirectToLogIn: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  // The session read (['auth', 'session']) and the 2FA status
  // (['backend', …]) share this hook; switch on the key.
  useQuery: (options: { queryKey?: unknown[] }) =>
    options.queryKey?.[0] === 'auth'
      ? {
          data: {
            data:
              h.session.createdAt === undefined
                ? null
                : { session: { createdAt: h.session.createdAt } },
          },
        }
      : { data: h.status.value },
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    passkey: { addPasskey: h.addPasskey },
    // The password confirmation is the one `$fetch` call
    // (`POST /api/auth/reauthenticate`).
    $fetch: h.reauthenticate,
  },
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ signOut: h.signOut }),
}));

vi.mock('@/app/lib/auth/log-in-redirect', () => ({
  redirectToLogIn: h.redirectToLogIn,
}));

// FormDialog resolves the org id from router params for its unsaved-changes
// guard; there is no router in a component test.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

import { PasskeyRegisterDialog } from './passkey-register-dialog';

const CONFIRM_DESCRIPTION =
  /you signed in a while ago\. confirm your password to add a passkey/i;

function renderDialog() {
  const onRegistered = vi.fn();
  const onOpenChange = vi.fn();
  const rendered = render(
    <PasskeyRegisterDialog
      open
      onOpenChange={onOpenChange}
      onRegistered={onRegistered}
    />,
  );
  return { ...rendered, onRegistered, onOpenChange };
}

describe('PasskeyRegisterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.session.createdAt = new Date(Date.now() - HOUR);
    h.status.value = { authenticated: true, hasCredential: true };
    h.addPasskey.mockResolvedValue({ data: { id: 'pk-1' }, error: null });
    h.reauthenticate.mockResolvedValue({ data: { status: true }, error: null });
  });

  it('goes straight to the passkey on a session signed in within the day', async () => {
    const { user, onRegistered } = renderDialog();

    const name = screen.getByLabelText('Passkey name');
    await user.clear(name);
    await user.type(name, 'Work laptop');
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));

    await waitFor(() =>
      expect(h.addPasskey).toHaveBeenCalledWith({ name: 'Work laptop' }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(h.reauthenticate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('asks for the password first on a session past the fresh window, then registers', async () => {
    h.session.createdAt = new Date(Date.now() - 25 * HOUR);
    const { user, onRegistered } = renderDialog();

    expect(screen.getByText(CONFIRM_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByLabelText('Passkey name')).not.toBeInTheDocument();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveFocus();

    await user.type(password, 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(h.reauthenticate).toHaveBeenCalledWith('/reauthenticate', {
        method: 'POST',
        body: { password: 'correct horse' },
      }),
    );
    const name = await screen.findByLabelText('Passkey name');
    expect(name).toHaveFocus();
    expect(h.addPasskey).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, 'Work laptop');
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));

    await waitFor(() =>
      expect(h.addPasskey).toHaveBeenCalledWith({ name: 'Work laptop' }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(1);
  });

  it('asks for the password when too little of the fresh window is left to finish', async () => {
    h.session.createdAt = new Date(Date.now() - (24 * HOUR - 2 * 60 * 1000));
    renderDialog();

    expect(screen.getByText(CONFIRM_DESCRIPTION)).toBeInTheDocument();
  });

  it('keeps the person on the password step when it is wrong', async () => {
    h.session.createdAt = new Date(Date.now() - 25 * HOUR);
    h.reauthenticate.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        statusText: 'BAD_REQUEST',
        code: 'INVALID_PASSWORD',
      },
    });
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'Wrong password. Repeated failed attempts temporarily lock your account.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Passkey name')).not.toBeInTheDocument();
    expect(h.addPasskey).not.toHaveBeenCalled();
  });

  it('says how long a locked account waits', async () => {
    h.session.createdAt = new Date(Date.now() - 25 * HOUR);
    h.reauthenticate.mockResolvedValue({
      data: null,
      error: {
        status: 429,
        statusText: 'TOO_MANY_REQUESTS',
        message: 'Invalid credentials',
        retryAfter: 120,
      },
    });
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'Account temporarily locked. Try again in 2 minutes, or contact an administrator.',
      ),
    ).toBeInTheDocument();
  });

  it('comes back to the password step when the server refuses the session as not fresh', async () => {
    // The browser's clock says fresh; the server's word is final.
    const { user } = renderDialog();
    h.addPasskey.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'SESSION_NOT_FRESH',
        message: 'Session is not fresh',
        status: 403,
        statusText: 'FORBIDDEN',
      },
    });

    const name = screen.getByLabelText('Passkey name');
    await user.clear(name);
    await user.type(name, 'Work laptop');
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));

    expect(await screen.findByText(CONFIRM_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText('Session is not fresh')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // The name typed before the detour survives it.
    expect(await screen.findByLabelText('Passkey name')).toHaveValue(
      'Work laptop',
    );
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(h.addPasskey).toHaveBeenCalledTimes(2));
    expect(h.addPasskey).toHaveBeenLastCalledWith({ name: 'Work laptop' });
  });

  it('offers to sign in again to an account without a password', async () => {
    h.session.createdAt = new Date(Date.now() - 25 * HOUR);
    h.status.value = { authenticated: true, hasCredential: false };
    h.signOut.mockResolvedValue(undefined);
    const { user } = renderDialog();

    expect(
      screen.getByText(
        /you signed in a while ago\. sign in again, then add your passkey/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => expect(h.redirectToLogIn).toHaveBeenCalledTimes(1));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.reauthenticate).not.toHaveBeenCalled();
  });

  it('passes an axe audit on the password step', async () => {
    h.session.createdAt = new Date(Date.now() - 25 * HOUR);
    const { baseElement } = renderDialog();

    await screen.findByLabelText('Password');
    await checkAccessibility(baseElement);
  });
});
