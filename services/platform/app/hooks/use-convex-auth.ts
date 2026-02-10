import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';

function useConvexAuthUser() {
  const { data: user, isLoading } = useQuery(
    convexQuery(api.users.queries.getCurrentUser, {}),
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
