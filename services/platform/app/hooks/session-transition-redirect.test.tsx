import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
  clearMemberContextCache: vi.fn(),
  clearTitleSuffix: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({ authClient: h }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { userId: 'u-1' }, isLoading: false }),
}));
vi.mock('@/app/lib/backend/account', () => ({
  currentUserQuery: () => ({ queryKey: ['backend', 'me', 'current-user'] }),
}));
vi.mock('@/app/lib/member-context-cache', () => ({
  clearMemberContextCache: h.clearMemberContextCache,
}));
vi.mock('@/app/lib/title-suffix', () => ({
  clearTitleSuffix: h.clearTitleSuffix,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => undefined,
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: null }),
}));
vi.mock('@/lib/env', () => ({
  getEnv: (key: string) =>
    key === 'BASE_PATH'
      ? '/tale'
      : key === 'SESSION_IDLE_TIMEOUT_MINUTES'
        ? 1
        : undefined,
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  toast: () => ({ dismiss: () => undefined }),
}));

const originalLocation = window.location;
let navigations: string[];

function deferred<T>() {
  let resolve = (_value: T) => {};
  let reject = (_reason: unknown) => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  // A successful sign-out belongs to the document being left. Each case
  // starts a fresh document, including the auth signal's module state.
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  document.cookie = 'tale_handoff_hold=; Max-Age=0; Path=/';
  navigations = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/tale/dashboard/org-1/settings/account',
      search: '',
      hash: '',
      protocol: 'https:',
      set href(value: string) {
        navigations.push(value);
      },
    },
  });
  h.getSession.mockResolvedValue({ data: null, error: null });
});

afterEach(async () => {
  cleanup();
  // A mocked location setter does not start the document's real unload.
  window.dispatchEvent(new Event('beforeunload'));
  await Promise.resolve();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  document.cookie = 'tale_handoff_hold=; Max-Age=0; Path=/';
});

async function authHooks() {
  const { useAuth } = await import('./use-session-user');
  const { useSessionLapseRedirect } =
    await import('./use-session-lapse-redirect');
  const { reportSessionLapsed } = await import('../lib/auth/session-lapse');
  const hook = renderHook(() => {
    const auth = useAuth();
    useSessionLapseRedirect(auth.isAuthenticated);
    return auth;
  });
  return { ...hook, reportSessionLapsed };
}

describe('intentional sign-out and session lapse overlap', () => {
  it('rechecks a stale live answer after a transition releases a deferred lapse', async () => {
    const checked = deferred<{ data: { user: { id: string } }; error: null }>();
    h.getSession.mockReturnValueOnce(checked.promise);
    const { reportSessionLapsed } = await authHooks();
    const { holdSessionLapseRedirects } =
      await import('../lib/auth/session-lapse');
    reportSessionLapsed();
    const resume = holdSessionLapseRedirects();
    reportSessionLapsed();
    resume();
    expect(h.getSession).toHaveBeenCalledOnce();
    checked.resolve({
      data: { user: { id: 'old-session-user' } },
      error: null,
    });
    await settle();
    expect(h.getSession).toHaveBeenCalledTimes(2);
    expect(navigations).toEqual([
      '/tale/log-in?redirectTo=%2Fdashboard%2Forg-1%2Fsettings%2Faccount&reason=session-ended',
    ]);
  });

  it('lets explicit sign-out finish its cleanup and own the navigation', async () => {
    const signedOut = deferred<{ error: null }>();
    h.signOut.mockReturnValue(signedOut.promise);
    const { result, reportSessionLapsed } = await authHooks();
    // All three useAuth sign-out callers navigate after this public promise.
    const leaving = result.current.signOut().then(() => {
      window.location.href = '/tale';
    });

    reportSessionLapsed();
    await settle();
    expect(navigations).toEqual([]);

    signedOut.resolve({ error: null });
    await leaving;
    reportSessionLapsed();
    await settle();
    expect(h.clearMemberContextCache).toHaveBeenCalledOnce();
    expect(h.clearTitleSuffix).toHaveBeenCalledOnce();
    expect(navigations).toEqual(['/tale']);

    // A dirty editor can cancel the native navigation. Once the unload guard
    // expires, the session that sign-out ended must be discoverable again.
    window.dispatchEvent(new Event('beforeunload'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    reportSessionLapsed();
    await settle();
    expect(navigations.at(-1)).toContain('reason=session-ended');
  });

  it('discards a lapse recheck already in flight when sign-out starts', async () => {
    const checked = deferred<{ data: null; error: null }>();
    const signedOut = deferred<{ error: null }>();
    h.getSession.mockReturnValue(checked.promise);
    h.signOut.mockReturnValue(signedOut.promise);
    const { result, reportSessionLapsed } = await authHooks();
    reportSessionLapsed();
    expect(h.getSession).toHaveBeenCalledOnce();
    const leaving = result.current.signOut().then(() => {
      window.location.href = '/tale';
    });

    checked.resolve({ data: null, error: null });
    await settle();
    expect(navigations).toEqual([]);
    signedOut.resolve({ error: null });
    await leaving;
    expect(navigations).toEqual(['/tale']);
  });

  it.each(['reject', 'error answer'] as const)(
    'restores lapse recovery after sign-out fails with %s',
    async (failure) => {
      h.signOut.mockImplementation(async () => {
        if (failure === 'reject') throw new Error('offline');
        return { data: null, error: { message: 'unavailable', status: 503 } };
      });
      const { result, reportSessionLapsed } = await authHooks();
      await expect(result.current.signOut()).rejects.toBeInstanceOf(Error);
      expect(h.clearMemberContextCache).not.toHaveBeenCalled();

      reportSessionLapsed();
      await settle();
      expect(navigations).toEqual([
        '/tale/log-in?redirectTo=%2Fdashboard%2Forg-1%2Fsettings%2Faccount&reason=session-ended',
      ]);
    },
  );

  it('sets the proxy hold and keeps the idle notice despite lapsed answers', async () => {
    const signedOut = deferred<{ error: null }>();
    h.signOut.mockReturnValue(signedOut.promise);
    const { useSessionIdleWatchdog } =
      await import('./use-session-idle-watchdog');
    const { useSessionLapseRedirect } =
      await import('./use-session-lapse-redirect');
    const { reportSessionLapsed } = await import('../lib/auth/session-lapse');
    renderHook(() => {
      useSessionIdleWatchdog();
      useSessionLapseRedirect(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(h.signOut).toHaveBeenCalledOnce();

    reportSessionLapsed();
    await settle();
    expect(navigations).toEqual([]);
    signedOut.resolve({ error: null });
    await settle();
    reportSessionLapsed();
    await settle();
    expect(document.cookie).toContain('tale_handoff_hold=1');
    expect(navigations).toEqual(['/tale/log-in?reason=idle']);

    window.dispatchEvent(new Event('beforeunload'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    reportSessionLapsed();
    await settle();
    expect(navigations.at(-1)).toContain('reason=session-ended');
  });
});
