import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardEntryFailure } from '@/app/components/layout/dashboard-entry-failure';
import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { setActiveOrganization } from '@/app/lib/auth/set-active-organization';
import { failureDetail } from '@/app/lib/backend/adapters';
import {
  lastActiveOrgQuery,
  recordOrgSwitch,
  userOrganizationsQuery,
  type UserOrganizationRow,
} from '@/app/lib/backend/org';
import { readStateOf } from '@/app/lib/backend/read-state';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/')({
  beforeLoad: async ({ context, location }) => {
    // fetchQuery rejects on transport failures (after retries) — fall back to
    // the signed-out path rather than surfacing a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (!session?.data?.user) {
      throw redirect({
        to: '/log-in',
        search: { redirectTo: location.href },
      });
    }
    return { user: session.data.user };
  },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(userOrganizationsQuery());
  },
  component: DashboardIndex,
});

/** An entry that failed: the organization it was opening, and why. */
interface EntryFailure {
  organizationName: string;
  error: unknown;
}

function DashboardIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useT('auth');
  const startedRef = useRef(false);
  const organizationsFailureRef = useRef<string | undefined>(undefined);
  const organizationsQuery = useQuery(userOrganizationsQuery());
  const { data: organizations, refetch: refetchOrganizations } =
    organizationsQuery;
  const { data: lastActiveOrgId, isLoading: isLastActiveLoading } =
    useQuery(lastActiveOrgQuery());
  const [entryFailure, setEntryFailure] = useState<EntryFailure | null>(null);
  const [retryingEntry, setRetryingEntry] = useState(false);

  // Open the organization the person works in, or the wizard when they have
  // none. Answers the failure, so the page can say what failed instead of
  // holding its frame; a success leaves the page.
  const enter = useCallback(
    async (
      memberships: UserOrganizationRow[],
      persistedOrgId: string | null | undefined,
    ): Promise<EntryFailure | null> => {
      const [first] = memberships;
      if (first === undefined) {
        // No org yet — route into the onboarding wizard so the user names
        // their own workspace. `default` is a scaffold template, never an
        // auto-created organization.
        void navigate({ to: '/dashboard/create-organization' });
        return null;
      }

      // Resolve target in priority:
      //   1. session.activeOrganizationId — in-flight preference for this
      //      session (e.g., user opened dashboard in tab A after switching).
      //   2. user.lastActiveOrganizationId — persistent preference that
      //      survives logout/login (written by recordOrgSwitch).
      //   3. first membership — fallback when neither exists or both point
      //      to orgs the user no longer belongs to.
      // The session's preference is only that: a read of it that gets no
      // answer falls back as one that is refused does.
      const session = await authClient.getSession().catch((error: unknown) => {
        console.warn(
          'Failed to read the session to enter an organization:',
          error,
        );
        return null;
      });
      const sessionActive = session?.data?.session?.activeOrganizationId;
      const target =
        memberships.find((o) => o.organizationId === sessionActive) ??
        memberships.find((o) => o.organizationId === persistedOrgId) ??
        first;

      try {
        await setActiveOrganization(target.organizationId);
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        try {
          await recordOrgSwitch(target.organizationId);
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }
        void navigate({
          to: '/dashboard/$id',
          params: { id: target.organizationId },
        });
        return null;
      } catch (error) {
        console.error('Failed to enter organization:', error);
        return { organizationName: target.name, error };
      }
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    if (startedRef.current || isLastActiveLoading || !organizations) return;
    startedRef.current = true;
    void enter(organizations, lastActiveOrgId).then(setEntryFailure);
  }, [isLastActiveLoading, organizations, lastActiveOrgId, enter]);

  const retryEntry = () => {
    setRetryingEntry(true);
    void refetchOrganizations()
      // The list as it stands now: a membership that ended since is no
      // longer a target. A read that fails again keeps the list it had.
      .then(({ data }) =>
        data === undefined ? entryFailure : enter(data, lastActiveOrgId),
      )
      .then((failure) => {
        setEntryFailure(failure);
        setRetryingEntry(false);
      });
  };

  // The list answered nothing the page can enter with: a fault after its
  // retries, or a refusal. A frame here would wait for good. The flags and
  // the failure's words hold through a retry, which react-query starts
  // from `pending` with no error.
  const organizationsRead = readStateOf(organizationsQuery);
  if (organizationsQuery.isError) {
    organizationsFailureRef.current = failureDetail(organizationsQuery.error);
  }
  if (organizationsRead.unavailable) {
    return (
      <DashboardEntryFailure
        title={t('dashboardEntry.organizationsFailed')}
        description={organizationsFailureRef.current}
        onRetry={() => void refetchOrganizations()}
        retrying={organizationsRead.retrying}
      />
    );
  }

  if (entryFailure) {
    return (
      <DashboardEntryFailure
        title={t('dashboardEntry.openFailed', {
          organization: entryFailure.organizationName,
        })}
        description={failureDetail(entryFailure.error)}
        onRetry={retryEntry}
        retrying={retryingEntry}
      />
    );
  }

  return <DashboardShellFrame />;
}
