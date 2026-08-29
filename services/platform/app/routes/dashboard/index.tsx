import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import {
  lastActiveOrgQuery,
  recordOrgSwitch,
  userOrganizationsQuery,
} from '@/app/lib/backend/org';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/dashboard/')({
  beforeLoad: async ({ context }) => {
    // fetchQuery rejects on transport failures (after retries) — fall back to
    // the signed-out path rather than surfacing a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(userOrganizationsQuery());
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resolvedRef = useRef(false);
  const { data: organizations, isLoading: isOrgsLoading } = useQuery(
    userOrganizationsQuery(),
  );
  const { data: lastActiveOrgId, isLoading: isLastActiveLoading } =
    useQuery(lastActiveOrgQuery());

  useEffect(() => {
    if (
      isOrgsLoading ||
      isLastActiveLoading ||
      !organizations ||
      resolvedRef.current
    )
      return;

    if (organizations.length === 0) {
      // No org yet — route into the onboarding wizard so the user names
      // their own workspace. `default` is a scaffold template, never an
      // auto-created organization.
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
          await recordOrgSwitch(targetOrgId);
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
    organizations,
    lastActiveOrgId,
    navigate,
    queryClient,
  ]);

  return <DashboardShellFrame />;
}
