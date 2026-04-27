import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
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
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [sessionVerified, setSessionVerified] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(true);

  // Client-side 2FA enforcement: when the org policy requires 2FA and the
  // user is past their (effective) grace deadline, route them to
  // /2fa-enroll. Catches normal entry paths (fresh login, existing
  // session restore, SSO callback, direct-URL navigation). A determined
  // client could still call Convex directly — server-side enforcement
  // is tracked separately.
  //
  // Uses client-side navigation (not window.location) so the browser's
  // `beforeunload` handlers in nested editors don't fire a "leave site?"
  // confirm dialog when redirecting an unenrolled user.
  const { data: twoFactorStatus } = useConvexQuery(
    api.two_factor.queries.getStatus,
    {},
    { enabled: isAuthenticated },
  );
  useEffect(() => {
    if (
      twoFactorStatus?.authenticated &&
      twoFactorStatus.decision === 'blocked'
    ) {
      const basePath = getEnv('BASE_PATH');
      const pathname = window.location.pathname;
      const routePath = basePath
        ? pathname.replace(new RegExp(`^${basePath}`), '')
        : pathname;
      const redirectTo = routePath + window.location.search;
      void navigate({
        to: '/2fa-enroll',
        search: { redirectTo },
        replace: true,
      });
    }
  }, [twoFactorStatus, navigate]);

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

  // Fail-closed: while authenticated but `getStatus` has not yet resolved
  // (or errored), hold the dashboard. Otherwise a transient query failure
  // would silently let a `'blocked'` user through.
  if (isAuthenticated && twoFactorStatus === undefined) {
    return null;
  }

  if (
    twoFactorStatus?.authenticated &&
    twoFactorStatus.decision === 'blocked'
  ) {
    return null;
  }

  return <Outlet />;
}
