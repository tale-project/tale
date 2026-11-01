import { useQuery } from '@tanstack/react-query';

import {
  holdSessionLapseRedirects,
  releaseSessionLapseHoldOnLeave,
} from '@/app/lib/auth/session-lapse';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { currentUserQuery } from '@/app/lib/backend/account';
import { clearMemberContextCache } from '@/app/lib/member-context-cache';
import { clearTitleSuffix } from '@/app/lib/title-suffix';
import { authClient } from '@/lib/auth-client';
import { isProxiedSession } from '@/lib/shared/proxied-session';

function useConvexAuthUser() {
  // This query IS the auth probe: the backend answers it on the session
  // cookie alone (401 → data undefined → unauthenticated), so it needs no
  // websocket and no auth gating.
  const { data: user, isLoading } = useQuery(currentUserQuery());
  // The proxy owns signing in and out for a session it asserted, so the app
  // offers no sign-out of its own for one.
  const { data: session } = useQuery(sessionQueryOptions);
  const proxied = isProxiedSession(session?.data?.session);

  const isAuthenticated = !!user;

  const signOut = async () => {
    // The caller owns the next hard navigation. Keep a late 401 (including a
    // recheck already in flight) from leaving before this cleanup finishes.
    const resumeLapseRedirects = holdSessionLapseRedirects();
    try {
      const result = await authClient.signOut();
      if (result?.error) throw new Error(result.error.message);
    } catch (error) {
      resumeLapseRedirects();
      throw error;
    }
    // Forget the cached org name so the logged-out shell renders "Tale" rather
    // than the previous org's suffix (the sign-out flows hard-navigate, so the
    // next document title is composed from a fresh, empty cache).
    clearTitleSuffix();
    // Sign-out revoked the session server-side: drop the pre-auth cache so
    // the next load can't hydrate the shell for the signed-out account
    // (#2386).
    clearMemberContextCache();
    releaseSessionLapseHoldOnLeave(resumeLapseRedirects);
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
 * hand-shake and nothing to wait for beyond that one request. It observes
 * that probe alone; the Better Auth session `useAuth` also holds answers
 * nothing returned here. A hook mounted once per read gates through
 * `useSessionProbeSignedIn` instead, which adds no observer (#4062).
 */
export function useSessionUser(): {
  isLoading: boolean;
  isAuthenticated: boolean;
} {
  const { data: user, isLoading } = useQuery(currentUserQuery());
  return { isLoading, isAuthenticated: !!user };
}
