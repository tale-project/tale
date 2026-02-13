import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useUserOrganizationCollection } from '@/app/features/organization/hooks/collections';
import { useUserOrganizations } from '@/app/features/organization/hooks/queries';
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
  const {
    organizations,
    isLoading: isOrgsLoading,
    isAuthLoading,
    isAuthenticated,
  } = useUserOrganizations(useUserOrganizationCollection());

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || isOrgsLoading || !organizations) {
      return;
    }

    const firstOrgId = organizations[0]?.organizationId;

    if (organizations.length === 0) {
      void navigate({ to: '/dashboard/create-organization' });
    } else if (firstOrgId) {
      void navigate({
        to: '/dashboard/$id',
        params: { id: firstOrgId },
      });
    }
  }, [isAuthLoading, isAuthenticated, isOrgsLoading, organizations, navigate]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}
