import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession },
}));

import { backendFetch } from '@/app/lib/backend/api-client';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import { useSessionLapseRedirect } from './use-session-lapse-redirect';

const realLocation = window.location;
/** Stands in for `window.location`: jsdom cannot navigate, and the hook's
 * redirect is a full load, so the assignment itself is what is observed. */
let page: { href: string; pathname: string; search: string; hash: string };

const SIGN_IN = `/log-in?redirectTo=${encodeURIComponent('/dashboard/org-1/products?view=grid')}&reason=session-ended`;

/** Let every pending promise callback run. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A request the page makes after its session ended: the session door
 * answers, and the app's fetch seam reads it. */
async function requestAfterTheSessionEnded(): Promise<void> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json(LAPSED_SESSION_ANSWER.body, {
      status: LAPSED_SESSION_ANSWER.status,
    }),
  );
  await backendFetch('/products', { orgId: 'org-1' }).catch(
    (error: unknown) => error,
  );
}

beforeEach(() => {
  h.getSession.mockReset();
  page = {
    href: 'http://localhost/dashboard/org-1/products?view=grid',
    pathname: '/dashboard/org-1/products',
    search: '?view=grid',
    hash: '',
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: page,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('useSessionLapseRedirect', () => {
  it('asks before taking the tab to sign-in after Better Auth confirms nobody is signed in', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(page.href).not.toContain('/log-in');
    act(() => result.current.continueToLogIn());
    await waitFor(() => expect(page.href).toBe(SIGN_IN));
    expect(h.getSession).toHaveBeenCalledTimes(2);
  });

  // A request that raced a session rotation (a TOTP verify replaces the
  // session) met the door with the old cookie; the new session is live.
  it('stays when the session is alive after all', async () => {
    h.getSession.mockResolvedValue({
      data: { user: { id: 'u-1' }, session: { id: 's-2' } },
      error: null,
    });
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();

    await waitFor(() => expect(h.getSession).toHaveBeenCalledTimes(1));
    expect(page.href).not.toContain('/log-in');
  });

  it.each([
    ['gets no answer', { data: null, error: { status: 0 } }],
    ['meets a server fault', { data: null, error: { status: 502 } }],
  ])('holds the page when the re-check %s', async (_case, answer) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.getSession.mockResolvedValue(answer);
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(page.href).not.toContain('/log-in');
  });

  it('holds the page when the re-check throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(page.href).not.toContain('/log-in');
  });

  it('shares one re-check between answers that land together, and checks again after a hold', async () => {
    let answer: (value: unknown) => void = () => undefined;
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();
    await requestAfterTheSessionEnded();
    await requestAfterTheSessionEnded();
    expect(h.getSession).toHaveBeenCalledTimes(1);

    answer({ data: { user: { id: 'u-1' } }, error: null });
    await settle();
    await requestAfterTheSessionEnded();
    await waitFor(() => expect(h.getSession).toHaveBeenCalledTimes(2));
  });

  // While the dashboard's own probe says the tab is not signed in, that
  // lane is re-checking and redirecting; this one keeps out of its way.
  it('does nothing while the dashboard does not count the tab as signed in', async () => {
    renderHook(() => useSessionLapseRedirect(false));

    await requestAfterTheSessionEnded();

    expect(h.getSession).not.toHaveBeenCalled();
    expect(page.href).not.toContain('/log-in');
  });

  it('does not redirect from a page that has already been left', async () => {
    let answer: (value: unknown) => void = () => undefined;
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { unmount } = renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();
    unmount();
    answer({ data: null, error: null });
    await settle();

    expect(h.getSession).toHaveBeenCalledTimes(1);
    expect(page.href).not.toContain('/log-in');
  });

  // A reload, a typed address or a sign-out's own hard navigation (the idle
  // watchdog's `?reason=idle`) is already taking the tab somewhere; a redirect
  // now would cancel it.
  it('leaves a navigation already under way alone', async () => {
    let answer: (value: unknown) => void = () => undefined;
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();
    window.dispatchEvent(new Event('beforeunload'));
    answer({ data: null, error: null });
    await settle();

    expect(h.getSession).toHaveBeenCalledTimes(1);
    expect(page.href).not.toContain('/log-in');
  });

  it('starts no re-check while the document unloads', async () => {
    renderHook(() => useSessionLapseRedirect(true));

    window.dispatchEvent(new Event('beforeunload'));
    await requestAfterTheSessionEnded();
    await settle();

    expect(h.getSession).not.toHaveBeenCalled();
  });

  // The unsaved-changes prompt can call a leave off; the tab then stays, and
  // a later lapsed-session answer still leads to sign-in.
  it('asks again once a leave that was called off is past', async () => {
    const realNow = Date.now.bind(Date);
    let later = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + later);
    h.getSession.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useSessionLapseRedirect(true));

    window.dispatchEvent(new Event('beforeunload'));
    later = 10_001;
    await requestAfterTheSessionEnded();

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(page.href).not.toContain('/log-in');
  });

  it('clears an obsolete confirmation when explicit sign-in finds a restored session', async () => {
    h.getSession
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const { result } = renderHook(() => useSessionLapseRedirect(true));
    await requestAfterTheSessionEnded();
    await waitFor(() => expect(result.current.open).toBe(true));
    act(() => result.current.continueToLogIn());
    await waitFor(() => expect(result.current.isLapsed).toBe(false));
    expect(page.href).not.toContain('/log-in');
  });

  it('keeps a failed explicit recheck retryable without leaving', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.getSession
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useSessionLapseRedirect(true));
    await requestAfterTheSessionEnded();
    await waitFor(() => expect(result.current.open).toBe(true));
    act(() => result.current.continueToLogIn());
    await waitFor(() => expect(result.current.checkFailed).toBe(true));
    expect(result.current.open).toBe(true);
    expect(page.href).not.toContain('/log-in');
    act(() => result.current.continueToLogIn());
    await waitFor(() => expect(page.href).toBe(SIGN_IN));
  });

  it('lets Stay here cancel a pending explicit sign-in recheck', async () => {
    let finish = (_value: { data: null; error: null }) => {};
    h.getSession
      .mockResolvedValueOnce({ data: null, error: null })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const { result } = renderHook(() => useSessionLapseRedirect(true));
    await requestAfterTheSessionEnded();
    await waitFor(() => expect(result.current.open).toBe(true));
    act(() => result.current.continueToLogIn());
    act(() => result.current.setOpen(false));
    await act(async () => finish({ data: null, error: null }));
    expect(result.current.open).toBe(false);
    expect(result.current.isLapsed).toBe(true);
    expect(page.href).not.toContain('/log-in');
  });
});
