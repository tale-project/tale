export { useConvexAuth } from 'convex/react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { clearTitleSuffix } from '@/app/lib/title-suffix';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';

function useConvexAuthUser() {
  // This query IS the auth probe — it must run before auth is established, so
  // it opts out of the default auth gate. Gating it would deadlock (the query
  // waits for auth; auth is derived from the query).
  const { data: user, isLoading } = useConvexQuery(
    api.users.queries.getCurrentUser,
    {},
    { requireAuth: false },
  );

  const isAuthenticated = !!user;

  const signOut = async () => {
    await authClient.signOut();
    // Forget the cached org name so the logged-out shell renders "Tale" rather
    // than the previous org's suffix (the sign-out flows hard-navigate, so the
    // next document title is composed from a fresh, empty cache).
    clearTitleSuffix();
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    signIn: async () => {},
    signOut,
  };
}

export function useAuth() {
  return useConvexAuthUser();
}
