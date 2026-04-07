import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';

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
  const [sessionVerified, setSessionVerified] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(true);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Convex auth may lag behind Better Auth after sign-up.
      // Re-check Better Auth before doing a hard redirect.
      void authClient
        .getSession()
        .then((session) => {
          setHasValidSession(!!session?.data?.user);
          setSessionVerified(true);
        })
        .catch(() => {
          setHasValidSession(false);
          setSessionVerified(true);
        });
    }
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    if (sessionVerified && !hasValidSession) {
      const basePath = getEnv('BASE_PATH');
      const pathname = window.location.pathname;
      const routePath = basePath
        ? pathname.replace(new RegExp(`^${basePath}`), '')
        : pathname;
      const returnTo = routePath + window.location.search;
      window.location.href = `${basePath}/log-in?redirectTo=${encodeURIComponent(returnTo)}`;
    }
  }, [sessionVerified, hasValidSession]);

  if (isLoading || (!isAuthenticated && !sessionVerified)) {
    return null;
  }

  if (sessionVerified && !hasValidSession) {
    return null;
  }

  return <Outlet />;
}
