import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  token: vi.fn(),
  // Mutable session state the useSession mock reads — a STABLE object whose
  // fields tests mutate before rerendering, mirroring Better Auth's atom.
  session: {
    data: null as { session: { id: string }; user: { id: string } } | null,
    isPending: true,
  },
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => h.session,
    convex: { token: h.token },
  },
}));

import {
  cacheConvexToken,
  takeWarmConvexToken,
  warmConvexToken,
} from '@/app/lib/auth/convex-token-cache';
import {
  getColdLoadTrace,
  resetColdLoadTraceForTests,
} from '@/app/lib/perf/cold-load-trace';

import { useAuthFromBetterAuth } from './use-auth-from-better-auth';

/** Unsigned JWT with the given payload — the cache never verifies signatures. */
function makeJwt(claims: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

const seedCachedToken = (sessionId: string, userId: string) => {
  const token = makeJwt({ sessionId, sub: userId, exp: inOneHour() });
  cacheConvexToken(token);
  return token;
};

const resolveSession = (sessionId: string, userId: string) => {
  h.session.data = { session: { id: sessionId }, user: { id: userId } };
  h.session.isPending = false;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  void takeWarmConvexToken(); // drain module-level warm state between tests
  resetColdLoadTraceForTests();
  h.session.data = null;
  h.session.isPending = true;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAuthFromBetterAuth — warm reload (persisted token)', () => {
  it('pre-authenticates from the cached token with ZERO HTTP hops', async () => {
    const token = seedCachedToken('s1', 'u1');

    const { result } = renderHook(() => useAuthFromBetterAuth());

    // Authenticated at mount — the WS handshake can start immediately instead
    // of waiting for session HTTP → token HTTP.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
    await expect(result.current.fetchAccessToken()).resolves.toBe(token);
    expect(h.token).not.toHaveBeenCalled();

    // The pre-auth path is visible on the recorded cold-load timeline (AC3).
    expect(getColdLoadTrace().map((m) => m.label)).toContain('convex-preauth');
  });

  it('keeps fetchAccessToken stable when the session resolves to the SAME session (no auth flap)', () => {
    seedCachedToken('s1', 'u1');
    const { result, rerender } = renderHook(() => useAuthFromBetterAuth());
    const initialFetch = result.current.fetchAccessToken;

    act(() => resolveSession('s1', 'u1'));
    rerender();

    // Same identity → same callback → ConvexProviderWithAuth never re-runs
    // setAuth, so the dashboard subtree is not unmounted mid-load.
    expect(result.current.fetchAccessToken).toBe(initialFetch);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('never replays the cached token once the live session turns out to be a DIFFERENT one', async () => {
    const staleToken = seedCachedToken('s1', 'u1');
    const freshToken = makeJwt({
      sessionId: 's2',
      sub: 'u2',
      exp: inOneHour(),
    });
    h.token.mockResolvedValue({ data: { token: freshToken } });

    const { result, rerender } = renderHook(() => useAuthFromBetterAuth());
    const initialFetch = result.current.fetchAccessToken;

    act(() => resolveSession('s2', 'u2'));
    rerender();

    // Mismatch rebuilds the callback (→ setAuth re-runs) and mints for the
    // true cookie identity instead of returning the stale cached token.
    expect(result.current.fetchAccessToken).not.toBe(initialFetch);
    let fetched: string | null = null;
    await act(async () => {
      fetched = await result.current.fetchAccessToken();
    });
    expect(fetched).toBe(freshToken);
    expect(fetched).not.toBe(staleToken);
    expect(h.token).toHaveBeenCalledTimes(1);
  });

  it('drops the cached token when Better Auth definitively resolves signed-out', () => {
    seedCachedToken('s1', 'u1');
    const { result, rerender } = renderHook(() => useAuthFromBetterAuth());
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      h.session.data = null;
      h.session.isPending = false;
    });
    rerender();

    expect(result.current.isAuthenticated).toBe(false);
    expect(window.sessionStorage.getItem('tale:convex-token')).toBeNull();
  });
});

describe('useAuthFromBetterAuth — cold path (no persisted token)', () => {
  it('behaves as today: loading until the session resolves, never pre-authenticated', () => {
    const { result } = renderHook(() => useAuthFromBetterAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(getColdLoadTrace().map((m) => m.label)).not.toContain(
      'convex-preauth',
    );
  });

  it('consumes the module-load warm mint instead of starting a third HTTP hop', async () => {
    const token = makeJwt({ sessionId: 's1', sub: 'u1', exp: inOneHour() });
    h.token.mockResolvedValue({ data: { token } });

    // router.tsx kicks this at module load, in parallel with the session fetch.
    warmConvexToken();
    expect(h.token).toHaveBeenCalledTimes(1);

    // The session (fetched in parallel) resolves to the same identity the
    // warm mint belongs to — the provider then asks for the token.
    act(() => resolveSession('s1', 'u1'));
    const { result } = renderHook(() => useAuthFromBetterAuth());
    let fetched: string | null = null;
    await act(async () => {
      fetched = await result.current.fetchAccessToken();
    });

    // The provider's first token request reuses the in-flight warm mint —
    // still exactly ONE token HTTP hop for the whole cold load.
    expect(fetched).toBe(token);
    expect(h.token).toHaveBeenCalledTimes(1);
  });

  it('discards a warm mint from before the sign-in and mints fresh for the new session', async () => {
    // A signed-out /log-in load warms the token path too: the mint resolves
    // null. That stale result must never stand in for the NEW session's token
    // after the user signs in — it would hand the websocket a null token and
    // strand auth until the recovery reload.
    h.token.mockResolvedValueOnce({ data: null });
    warmConvexToken();

    const freshToken = makeJwt({
      sessionId: 's1',
      sub: 'u1',
      exp: inOneHour(),
    });
    h.token.mockResolvedValueOnce({ data: { token: freshToken } });
    act(() => resolveSession('s1', 'u1'));

    const { result } = renderHook(() => useAuthFromBetterAuth());
    let fetched: string | null = null;
    await act(async () => {
      fetched = await result.current.fetchAccessToken();
    });

    expect(fetched).toBe(freshToken);
    expect(h.token).toHaveBeenCalledTimes(2);
  });

  it('a forced refresh mints anew and persists the fresh token for the next load', async () => {
    const token = makeJwt({ sessionId: 's1', sub: 'u1', exp: inOneHour() });
    h.token.mockResolvedValue({ data: { token } });
    act(() => resolveSession('s1', 'u1'));

    const { result } = renderHook(() => useAuthFromBetterAuth());
    let fetched: string | null = null;
    await act(async () => {
      fetched = await result.current.fetchAccessToken({
        forceRefreshToken: true,
      });
    });

    expect(fetched).toBe(token);
    expect(h.token).toHaveBeenCalledTimes(1);
    // Persisted → the NEXT cold load can pre-authenticate.
    expect(window.sessionStorage.getItem('tale:convex-token')).toBe(token);
  });
});
