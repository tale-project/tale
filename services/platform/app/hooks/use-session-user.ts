import { useQuery } from '@tanstack/react-query';

import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { currentUserQuery } from '@/app/lib/backend/account';
import { clearMemberContextCache } from '@/app/lib/member-context-cache';
import { clearTitleSuffix } from '@/app/lib/title-suffix';
import { authClient } from '@/lib/auth-client';

function useConvexAuthUser() {
  // This query IS the auth probe: the backend answers it on the session
  // cookie alone (401 → data undefined → unauthenticated), so it needs no
  // websocket and no auth gating.
  const { data: user, isLoading } = useQuery(currentUserQuery());
  // A session an authenticating proxy asserted carries the organization it
  // was minted for; the proxy owns signing in and out for it, so the app
  // offers no sign-out of its own. Read loosely: the field is one of the
  // deployment's own session columns, not part of the client's inferred type.
  const { data: session } = useQuery(sessionQueryOptions);
  const sessionRecord: Record<string, unknown> | undefined =
    session?.data?.session;
  const proxied = typeof sessionRecord?.trustedOrganizationId === 'string';

  const isAuthenticated = !!user;

  const signOut = async () => {
    await authClient.signOut();
    // Forget the cached org name so the logged-out shell renders "Tale" rather
    // than the previous org's suffix (the sign-out flows hard-navigate, so the
    // next document title is composed from a fresh, empty cache).
    clearTitleSuffix();
    // Sign-out revoked the session server-side: drop the pre-auth cache so
    // the next load can't hydrate the shell for the signed-out account
    // (#2386).
    clearMemberContextCache();
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    proxied,
    signIn: async () => {},
    signOut,
  };
}

export function useAuth() {
  return useConvexAuthUser();
}

/**
 * The auth shape the app's hooks gate on. It used to be Convex's — the
 * WebSocket handshake's state — and is now the session probe's: the backend
 * answers `currentUser` on the session cookie alone, so there is nothing to
 * hand-shake and nothing to wait for beyond that one request.
 */
export function useSessionUser(): {
  isLoading: boolean;
  isAuthenticated: boolean;
} {
  const { isLoading, isAuthenticated } = useConvexAuthUser();
  return { isLoading, isAuthenticated };
}
