import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { authClient } from '@/lib/auth-client';

const sessionQueryOptions = {
  queryKey: ['auth', 'session'],
  queryFn: () => authClient.getSession(),
  staleTime: 5 * 60 * 1000, // 5 minutes
};

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context }) => {
    // Use TanStack Query for caching and deduplication
    const session = await context.queryClient.fetchQuery(sessionQueryOptions);
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/log-in?redirectTo=${encodeURIComponent(returnTo)}`;
    }
  }, [isLoading, isAuthenticated]);

  if (!isLoading && !isAuthenticated) {
    return null;
  }

  return <Outlet />;
}
