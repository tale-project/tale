// @vitest-environment jsdom
import { AppShell } from '@tale/ui/app-shell';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

const h = vi.hoisted(() => ({
  reauthenticate: vi.fn(),
  invalidateAuthState: vi.fn(),
  signOut: vi.fn(),
  redirectToLogIn: vi.fn(),
  queryClient: { name: 'the query client' },
}));

vi.mock('@/app/lib/auth/session-freshness', () => ({
  reauthenticate: h.reauthenticate,
}));
vi.mock('@/app/lib/auth/session-query', () => ({
  invalidateAuthState: h.invalidateAuthState,
}));
vi.mock('@/app/hooks/use-react-query-client', () => ({
  useReactQueryClient: () => h.queryClient,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ signOut: h.signOut }),
}));
vi.mock('@/app/lib/auth/log-in-redirect', () => ({
  redirectToLogIn: h.redirectToLogIn,
}));

import { useConfirmPassword } from './use-confirm-password';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

function setup() {
  const onConfirmed = vi.fn();
  const view = renderHook(() => useConfirmPassword({ onConfirmed }), {
    wrapper,
  });
  return { ...view, onConfirmed };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reauthenticate.mockResolvedValue({ ok: true });
  h.invalidateAuthState.mockResolvedValue(undefined);
  h.signOut.mockResolvedValue(undefined);
});

describe('confirming a password again', () => {
  it('forgets the password, says it is confirmed and drops what was cached about the old session', async () => {
    const { result, onConfirmed } = setup();
    act(() => result.current.setPassword('correct horse'));
    await act(() => result.current.confirm());
    expect(h.reauthenticate).toHaveBeenCalledExactlyOnceWith('correct horse');
    expect(result.current.password).toBe('');
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(h.invalidateAuthState).toHaveBeenCalledExactlyOnceWith(
      h.queryClient,
    );
    expect(result.current.error).toBeNull();
    expect(result.current.passwordless).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  it('is confirmed even when dropping what was cached fails, and says so in the log', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.invalidateAuthState.mockRejectedValue(new Error('offline'));
    const { result, onConfirmed } = setup();
    act(() => result.current.setPassword('correct horse'));
    await act(() => result.current.confirm());
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();
  });

  it('says a wrong password is wrong, with the warning about repeated tries, and keeps what was typed', async () => {
    h.reauthenticate.mockResolvedValue({ ok: false, reason: 'wrong-password' });
    const { result, onConfirmed } = setup();
    act(() => result.current.setPassword('nope'));
    await act(() => result.current.confirm());
    expect(result.current.error).toMatch(/Wrong password/);
    expect(result.current.password).toBe('nope');
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(h.invalidateAuthState).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  it('says how long an account is locked for', async () => {
    h.reauthenticate.mockResolvedValue({
      ok: false,
      reason: 'locked',
      retryAfterSec: 120,
    });
    const { result } = setup();
    act(() => result.current.setPassword('nope'));
    await act(() => result.current.confirm());
    expect(result.current.error).toMatch(/2 minutes/);
  });

  it('knows an account without a password, and says nothing about it', async () => {
    h.reauthenticate.mockResolvedValue({ ok: false, reason: 'no-password' });
    const { result, onConfirmed } = setup();
    act(() => result.current.setPassword('anything'));
    await act(() => result.current.confirm());
    expect(result.current.passwordless).toBe(true);
    expect(result.current.error).toBeNull();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('says it could not confirm for any other failure, and can try again', async () => {
    h.reauthenticate.mockResolvedValue({ ok: false, reason: 'failed' });
    const { result } = setup();
    act(() => result.current.setPassword('anything'));
    await act(() => result.current.confirm());
    expect(result.current.error).toBe(
      'Couldn’t confirm your password. Try again.'.replace('’', "'"),
    );
    expect(result.current.submitting).toBe(false);
    expect(result.current.passwordless).toBe(false);
  });

  it('is checking while the answer is awaited, and has dropped the last refusal by then', async () => {
    h.reauthenticate.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    const { result } = setup();
    act(() => result.current.setPassword('anything'));
    await act(() => result.current.confirm());
    expect(result.current.error).not.toBeNull();
    let finish: (value: unknown) => void = () => undefined;
    h.reauthenticate.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.confirm();
    });
    expect(result.current.submitting).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      finish({ ok: true });
      await pending;
    });
    expect(result.current.submitting).toBe(false);
  });

  it('drops a refusal when the person types again, and forgets everything on reset', async () => {
    h.reauthenticate.mockResolvedValue({ ok: false, reason: 'wrong-password' });
    const { result } = setup();
    act(() => result.current.setPassword('nope'));
    await act(() => result.current.confirm());
    expect(result.current.error).not.toBeNull();
    act(() => result.current.setPassword('nope!'));
    expect(result.current.error).toBeNull();
    expect(result.current.password).toBe('nope!');
    await act(() => result.current.confirm());
    expect(result.current.error).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.password).toBe('');
    expect(result.current.error).toBeNull();
  });
});

describe('signing in again', () => {
  it('ends the session and takes the person to sign in, which brings them back', async () => {
    const { result } = setup();
    await act(() => result.current.signInAgain());
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.redirectToLogIn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('stays where it is, and says so, when the session cannot be ended', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.signOut.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await act(() => result.current.signInAgain());
    expect(h.redirectToLogIn).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/sign/i);
    expect(result.current.submitting).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
