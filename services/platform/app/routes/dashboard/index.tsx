import { convexQuery } from '@convex-dev/react-query';
import { Spinner } from '@tale/ui/spinner';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useAction, useMutation } from 'convex/react';
import { useEffect, useRef } from 'react';

import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
      convexQuery(api.members.queries.getUserOrganizationsWithDetails, {}),
    );
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initializeWorkflows = useAction(
    api.organizations.actions.initializeDefaultWorkflows,
  );
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const resolvedRef = useRef(false);
  const { data: organizations, isLoading: isOrgsLoading } = useConvexQuery(
    api.members.queries.getUserOrganizationsWithDetails,
  );
  const { data: lastActiveOrgId, isLoading: isLastActiveLoading } =
    useConvexQuery(api.users.get_last_active_org.getLastActiveOrganizationId);

  useEffect(() => {
    if (
      isOrgsLoading ||
      isLastActiveLoading ||
      !organizations ||
      resolvedRef.current
    )
      return;

    if (organizations.length === 0) {
      resolvedRef.current = true;
      void createDefaultOrganization();
      return;
    }

    resolvedRef.current = true;

    void (async () => {
      // Resolve target in priority:
      //   1. session.activeOrganizationId — in-flight preference for this
      //      session (e.g., user opened dashboard in tab A after switching).
      //   2. user.lastActiveOrganizationId — persistent preference that
      //      survives logout/login (written by recordOrgSwitch).
      //   3. first membership — fallback when neither exists or both point
      //      to orgs the user no longer belongs to.
      const session = await authClient.getSession();
      const sessionActive = session?.data?.session?.activeOrganizationId;
      const sessionStillMember = sessionActive
        ? organizations.some((o) => o.organizationId === sessionActive)
        : false;
      const persistedStillMember = lastActiveOrgId
        ? organizations.some((o) => o.organizationId === lastActiveOrgId)
        : false;
      const targetOrgId = sessionStillMember
        ? sessionActive
        : persistedStillMember
          ? lastActiveOrgId
          : organizations[0]?.organizationId;

      if (!targetOrgId) {
        // Shouldn't happen given organizations.length > 0 check above, but
        // guard just in case.
        resolvedRef.current = false;
        return;
      }

      try {
        await authClient.organization.setActive({
          organizationId: targetOrgId,
        });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        try {
          await recordOrgSwitch({ organizationId: targetOrgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }
        void navigate({
          to: '/dashboard/$id',
          params: { id: targetOrgId },
        });
      } catch (err) {
        console.error('Failed to enter organization:', err);
        resolvedRef.current = false;
      }
    })();

    async function createDefaultOrganization() {
      try {
        const result = await authClient.organization.create({
          name: 'Default',
          slug: 'default',
        });
        const orgId = result.data?.id;
        if (!orgId) throw new Error('Failed to create organization');

        await authClient.organization.setActive({ organizationId: orgId });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        await initializeWorkflows({ organizationId: orgId });

        try {
          await recordOrgSwitch({ organizationId: orgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }

        void navigate({ to: '/dashboard/$id', params: { id: orgId } });
      } catch (error) {
        console.error('Failed to create default organization:', error);
        void navigate({ to: '/dashboard/create-organization' });
      }
    }
  }, [
    isOrgsLoading,
    isLastActiveLoading,
    organizations,
    lastActiveOrgId,
    navigate,
    initializeWorkflows,
    queryClient,
    recordOrgSwitch,
  ]);

  return (
    <FullPageCenter>
      <Spinner size="lg" />
    </FullPageCenter>
  );
}
