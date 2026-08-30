import type { QueryClient } from '@tanstack/react-query';

import { warmConvexToken } from '@/app/lib/auth/convex-token-cache';
import { authClient } from '@/lib/auth-client';

/**
 * Shared TanStack Query options for the Better Auth session.
 *
 * Routing every session read through one cache key (`['auth', 'session']`)
 * with a 5-minute staleTime deduplicates the redundant `getSession()` HTTP
 * hops that otherwise pile onto the cold-load redirect chain
 * (`/` → `/dashboard` → `/dashboard/$id`). The first call in a chain populates
 * the cache; the rest are instant cache hits.
 */
export const sessionQueryOptions = {
  queryKey: ['auth', 'session'] as const,
  queryFn: async () => {
    const session = await authClient.getSession();
    // Better Auth resolves transport failures as `{ data: null, error }`
    // instead of throwing. Returning that would cache "signed out" as fresh
    // data for the whole staleTime and bounce a logged-in user to /log-in
    // while the backend is still warming up. Throw so TanStack Query treats
    // it as a failure: retryable, never cached as data. Genuine signed-out
    // (`data: null`, no transport error) still resolves normally.
    const status = session?.error?.status;
    if (status !== undefined && (status === 0 || status >= 500)) {
      throw new Error(`getSession failed with status ${status}`);
    }
    return session;
  },
  staleTime: 5 * 60 * 1000, // 5 minutes
  // The auth fetch layer already retries 5xx with backoff (see auth-client);
  // one extra round here covers a backend that came up between the two.
  retry: 1,
};

/**
 * Drop every cached answer that depends on WHO is signed in: the Better Auth
 * session AND the 0.5 backend's `me`-scoped reads (`['backend', 'me', …]` —
 * the `useAuth` probe, 2FA status, account flags, org memberships). Call it
 * after ANY auth-state change (sign-up, log-in, 2FA, log-out, org delete);
 * invalidating only the session key leaves the backend probe answering for
 * the PREVIOUS identity until a remount happens to refetch it.
 */
export function invalidateAuthState(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['auth', 'session'] }),
    queryClient.invalidateQueries({ queryKey: ['backend', 'me'] }),
  ]).then(() => undefined);
}

/**
 * Fire the session request as early as possible — at module load, before React
 * mounts the auth provider (`ConvexProviderWithAuth` +
 * `useAuthFromBetterAuth`). The hook's `useSession()` (and the Convex JWT
 * fetch that authenticates the websocket) can then resolve against already
 * in-flight requests instead of starting fresh serial HTTP hops only after
 * mount. This trims the cold-load auth handshake that blocks every
 * authenticated query.
 */
export function warmSession(): void {
  if (typeof window === 'undefined') return;
  void authClient.getSession();
  // Also mint the Convex JWT at module load, in PARALLEL with the session
  // fetch — the second serial hop that gates the websocket authentication on
  // cold load. The result is persisted and kept in flight so the auth
  // provider's first `fetchAccessToken` consumes it instead of starting a
  // third HTTP hop (see convex-token-cache).
  warmConvexToken();
}
