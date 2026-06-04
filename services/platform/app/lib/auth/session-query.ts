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
  queryFn: () => authClient.getSession(),
  staleTime: 5 * 60 * 1000, // 5 minutes
};

/**
 * Fire the session request as early as possible — at module load, before React
 * mounts `ConvexBetterAuthProvider`. The provider's `useSession()` (and the
 * Convex JWT fetch it gates on, which authenticates the websocket) can then
 * resolve against an already in-flight request instead of starting a fresh
 * serial HTTP hop only after mount. This trims the cold-load auth handshake
 * that blocks every authenticated query.
 */
export function warmSession(): void {
  if (typeof window === 'undefined') return;
  void authClient.getSession();
  // Also prime the Convex JWT path at module load (warm connection + server
  // mint + JWKS), so the auth provider's own token fetch — the second serial
  // hop that gates the websocket authentication on cold load — resolves faster.
  void authClient.convex?.token?.({ fetchOptions: { throw: false } });
}
