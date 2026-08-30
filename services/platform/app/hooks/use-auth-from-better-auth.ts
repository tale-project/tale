import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  clearConvexTokenCache,
  fetchFreshConvexToken,
  isTokenUsable,
  readCachedConvexToken,
  takeWarmConvexToken,
  type CachedConvexToken,
} from '@/app/lib/auth/convex-token-cache';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { authClient } from '@/lib/auth-client';

interface UseAuthArgs {
  forceRefreshToken?: boolean;
}

export interface ConvexAuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args?: UseAuthArgs) => Promise<string | null>;
}

/**
 * The `useAuth` bridge between Better Auth and convex/react's
 * `ConvexProviderWithAuth`, replacing `ConvexBetterAuthProvider`'s internal
 * `useUseAuthFromBetterAuth` to close the cold-load auth handshake (#2386).
 * A deliberate fork — the library hook is not exported, and neither of its
 * shapes fits:
 *
 * - Without `initialToken` it serializes the hops: session HTTP → token HTTP →
 *   WS authenticate (~830ms of blocked auth-gated queries in the epic's trace).
 * - With `initialToken` it rebuilds `fetchAccessToken` when the session
 *   resolves (keyed on session id, unknown at mount), which re-runs `setAuth`
 *   and flaps `useSessionUser().isAuthenticated` — unmounting the whole
 *   dashboard subtree mid-load.
 *
 * This hook instead:
 *
 * 1. Pre-authenticates the WS with the persisted last-known token
 *    (`convex-token-cache`) — reporting `isAuthenticated` immediately so
 *    `setAuth` runs at mount; the Convex auth manager confirms the cached
 *    token and immediately force-refreshes a fresh cookie-minted one.
 * 2. Keys `fetchAccessToken` on the token's OWN `sessionId` claim until the
 *    live session resolves. On the common warm reload both match, so the
 *    callback identity is stable and no flap occurs; a mismatch (a different
 *    session/user owns the cookie) rebuilds it, which re-runs `setAuth` with a
 *    freshly minted token for the true cookie identity.
 * 3. With no persisted token, behaves as today (wait for the session), except
 *    the first `fetchAccessToken` consumes the token fetch already in flight
 *    since module load (`warmConvexToken`) — session and token HTTP hops run
 *    in parallel instead of serially.
 *
 * Auth-gated queries still unlock only when the Convex BACKEND confirms a
 *    token (`useSessionUser().isAuthenticated` — see `ConvexProviderWithAuth`);
 * this hook never fabricates that confirmation.
 */
export function useAuthFromBetterAuth(): ConvexAuthState {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const liveSessionId = session?.session?.id ?? null;

  const [cached, setCached] = useState<CachedConvexToken | null>(
    readCachedConvexToken,
  );
  const cachedRef = useRef(cached);
  cachedRef.current = cached;

  // Trace the pre-auth path so the [cold-load] timeline shows when a persisted
  // token skipped the serial handshake (dedup'd; effect keeps render pure).
  useEffect(() => {
    if (cachedRef.current) markColdLoad('convex-preauth');
  }, []);

  // Better Auth definitively resolved signed-out → drop the cached token so
  // `isAuthenticated` flips false and the provider clears the WS auth.
  useEffect(() => {
    if (!session && !isSessionPending && cachedRef.current) {
      clearConvexTokenCache();
      setCached(null);
    }
  }, [session, isSessionPending]);

  // The session identity the WS auth is bound to: the live session once known,
  // else the persisted token's own session claim. Changing it rebuilds
  // `fetchAccessToken`, which makes `ConvexProviderWithAuth` re-run `setAuth`.
  const authSessionId = liveSessionId ?? cached?.sessionId ?? null;

  const pendingRef = useRef<Promise<string | null> | null>(null);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken = false }: UseAuthArgs = {}) => {
      if (!forceRefreshToken) {
        // Pre-auth fast path: hand the WS the last-known token synchronously —
        // but only when it belongs to the session this callback is keyed to; a
        // stale record for another session is never replayed.
        const current = cachedRef.current;
        if (
          current &&
          current.sessionId === authSessionId &&
          isTokenUsable(current)
        ) {
          return current.token;
        }
        if (pendingRef.current) return pendingRef.current;
      }

      // Consume the mint in flight since module load if it's still unclaimed
      // (`warmConvexToken`) — when it minted a token for the session this
      // callback is keyed to it IS a fresh cookie mint of the true current
      // identity, so it satisfies forced refreshes too. A warm result that
      // resolved signed-out or for another session (e.g. minted on the login
      // screen BEFORE this sign-in) is discarded — handing the websocket that
      // stale null/token would strand auth — and a fresh token minted instead.
      const consumeWarmOrMint = async (): Promise<CachedConvexToken | null> => {
        const warm = takeWarmConvexToken();
        if (warm) {
          const record = await warm;
          if (
            record &&
            (authSessionId === null || record.sessionId === authSessionId)
          ) {
            return record;
          }
        }
        return fetchFreshConvexToken();
      };
      const minted = consumeWarmOrMint()
        .then((record) => {
          setCached(record);
          return record?.token ?? null;
        })
        .catch((error: unknown) => {
          console.warn('Failed to fetch Convex token:', error);
          setCached(null);
          return null;
        })
        .finally(() => {
          pendingRef.current = null;
        });
      pendingRef.current = minted;
      return minted;
    },
    [authSessionId],
  );

  // Usable = a cached token that doesn't contradict the resolved session.
  const cachedMatchesSession =
    cached !== null &&
    (liveSessionId === null || cached.sessionId === liveSessionId);

  return useMemo(
    () => ({
      isLoading: isSessionPending && !cachedMatchesSession,
      isAuthenticated: Boolean(session?.session) || cachedMatchesSession,
      fetchAccessToken,
    }),
    [isSessionPending, cachedMatchesSession, session, fetchAccessToken],
  );
}
