import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TeamsEmptyState } from '@/app/features/settings/teams/components/teams-empty-state';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { TeamsTableSkeleton } from '@/app/features/settings/teams/components/teams-table-skeleton';
import {
  useApproxTeamCount,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  head: () => ({
    meta: seo('teams'),
  }),
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getMyTeams, {
        organizationId: params.id,
      }),
    );
    try {
      await context.queryClient.ensureQueryData(
        convexQuery(api.members.queries.approxCountMyTeams, {
          organizationId: params.id,
        }),
      );
    } catch {
      // Fall through — count will be undefined, handled in component
    }
  },
  component: TeamsSettingsPage,
});

function TeamsSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId, isAuthLoading || !isAuthenticated);
  const { data: count } = useApproxTeamCount(organizationId);
  const { teams } = useTeams();

  if (isAuthLoading || isMemberLoading) {
    return (
      <TeamsTableSkeleton
        organizationId={organizationId}
        rows={Math.min(count ?? 10, 10)}
      />
    );
  }

  if (!memberContext || !memberContext.isAdmin) {
    return <AccessDenied message={t('teams')} />;
  }

  if (count === undefined) {
    return <TeamsTableSkeleton organizationId={organizationId} rows={10} />;
  }

  if (count === 0) {
    return <TeamsEmptyState organizationId={organizationId} />;
  }

  return <TeamsTable teams={teams} organizationId={organizationId} />;
}
