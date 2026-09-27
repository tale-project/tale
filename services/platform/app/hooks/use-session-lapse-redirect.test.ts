import { renderHook, waitFor } from '@testing-library/react';
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
  it('takes the tab to sign-in once Better Auth confirms nobody is signed in', async () => {
    h.getSession.mockResolvedValue({ data: null, error: null });
    renderHook(() => useSessionLapseRedirect(true));

    await requestAfterTheSessionEnded();

    await waitFor(() => expect(page.href).toBe(SIGN_IN));
    expect(h.getSession).toHaveBeenCalledTimes(1);
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
});
