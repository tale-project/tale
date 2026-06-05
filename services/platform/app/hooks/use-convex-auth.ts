export { useConvexAuth } from 'convex/react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
