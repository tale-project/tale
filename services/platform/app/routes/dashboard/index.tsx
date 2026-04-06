import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { useEffect, useRef } from 'react';

import { Spinner } from '@/app/components/ui/feedback/spinner';
import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { useUserOrganizations } from '@/app/features/organization/hooks/queries';
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
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getUserOrganizationsList, {}),
    );
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const initializeWorkflows = useAction(
    api.organizations.actions.initializeDefaultWorkflows,
  );
  const creatingRef = useRef(false);
  const {
    organizations,
    isLoading: isOrgsLoading,
    isAuthLoading,
    isAuthenticated,
  } = useUserOrganizations();

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || isOrgsLoading || !organizations) {
      return;
    }

    const firstOrgId = organizations[0]?.organizationId;

    if (organizations.length === 0 || !firstOrgId) {
      if (creatingRef.current) return;
      creatingRef.current = true;
      void createDefaultOrganization();
    } else {
      void navigate({
        to: '/dashboard/$id',
        params: { id: firstOrgId },
      });
    }

    async function createDefaultOrganization() {
      try {
        const result = await authClient.organization.create({
          name: 'Default',
          slug: 'default',
        });
        const orgId = result.data?.id;
        if (!orgId) throw new Error('Failed to create organization');

        await authClient.organization.setActive({ organizationId: orgId });
        await initializeWorkflows({ organizationId: orgId });

        void navigate({ to: '/dashboard/$id', params: { id: orgId } });
      } catch (error) {
        console.error('Failed to create default organization:', error);
        void navigate({ to: '/dashboard/create-organization' });
      }
    }
  }, [
    isAuthLoading,
    isAuthenticated,
    isOrgsLoading,
    organizations,
    navigate,
    initializeWorkflows,
  ]);

  return (
    <FullPageCenter>
      <Spinner size="lg" />
    </FullPageCenter>
  );
}
