import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { authClient } from '@/lib/auth-client';

export function useConvexAuthUser() {
  // Get current user data
  const user = useQuery(api.users.getCurrentUser);

  // Loading is undefined during query fetch
  const isLoading = user === undefined;
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
