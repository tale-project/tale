import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useConvexAuth } from 'convex/react';
import { useEffect } from 'react';

import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/dashboard/')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const { data: organizations, isLoading: isOrgsLoading } = useQuery(
    convexQuery(
      api.members.queries.getUserOrganizationsList,
      isAuthLoading || !isAuthenticated ? 'skip' : {},
    ),
  );

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || isOrgsLoading || !organizations) {
      return;
    }

    if (organizations.length === 0) {
      void navigate({ to: '/dashboard/create-organization' });
    } else {
      void navigate({
        to: '/dashboard/$id',
        params: { id: organizations[0].organizationId },
      });
    }
  }, [isAuthLoading, isAuthenticated, isOrgsLoading, organizations, navigate]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}
