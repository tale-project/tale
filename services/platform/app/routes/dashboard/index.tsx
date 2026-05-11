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
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const initializeWorkflows = useAction(
    api.organizations.actions.initializeDefaultWorkflows,
  );
  const resolvedRef = useRef(false);
  const { data: organizations, isLoading: isOrgsLoading } = useConvexQuery(
    api.members.queries.getUserOrganizationsWithDetails,
  );
  const { data: lastActiveOrgId, isLoading: isLastActiveLoading } =
    useConvexQuery(api.users.get_last_active_org.getLastActiveOrganizationId);
  const { data: instanceHasAnyOrg, isLoading: isInstanceCheckLoading } =
    useConvexQuery(api.organizations.queries.instanceHasAnyOrganization);

  useEffect(() => {
    if (
      isOrgsLoading ||
      isLastActiveLoading ||
      isInstanceCheckLoading ||
      !organizations ||
      instanceHasAnyOrg === undefined ||
      resolvedRef.current
    )
      return;

    if (organizations.length === 0) {
      // Fresh instance (no orgs anywhere): seed the `default` org so the
      // many hardcoded `orgSlug: 'default'` callsites have something to
      // resolve against. If the instance already has orgs and this user
      // simply isn't a member, route to the create-organization form so
      // they pick their own non-`default` slug (multi-org deployment).
      if (!instanceHasAnyOrg) {
        resolvedRef.current = true;
        void (async () => {
          try {
            const result = await authClient.organization.create({
              name: 'Default',
              slug: 'default',
            });
            const orgId = result.data?.id;
            if (!orgId) throw new Error('Failed to create organization');

            await authClient.organization.setActive({ organizationId: orgId });
            await queryClient.invalidateQueries({
              queryKey: ['auth', 'session'],
            });
            await initializeWorkflows({ organizationId: orgId });

            try {
              await recordOrgSwitch({ organizationId: orgId });
            } catch (err) {
              console.warn('Failed to record org switch audit entry:', err);
            }

            void navigate({ to: '/dashboard/$id', params: { id: orgId } });
          } catch (error) {
            // Likely a slug-conflict race (another tab/user beat us to
            // creating `default`). Drop the resolved guard and invalidate
            // the cached instance-org existence so the effect re-runs and
            // routes us through the form branch below.
            console.warn(
              'Auto-create of default organization failed; falling back to create-organization form:',
              error,
            );
            await queryClient.invalidateQueries(
              convexQuery(
                api.organizations.queries.instanceHasAnyOrganization,
                {},
              ),
            );
            resolvedRef.current = false;
          }
        })();
        return;
      }

      resolvedRef.current = true;
      void navigate({ to: '/dashboard/create-organization' });
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
  }, [
    isOrgsLoading,
    isLastActiveLoading,
    isInstanceCheckLoading,
    organizations,
    lastActiveOrgId,
    instanceHasAnyOrg,
    navigate,
    queryClient,
    recordOrgSwitch,
    initializeWorkflows,
  ]);

  return (
    <FullPageCenter>
      <Spinner size="lg" />
    </FullPageCenter>
  );
}
