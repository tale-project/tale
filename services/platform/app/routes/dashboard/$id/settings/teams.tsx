import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import {
  useApproxTeamCount,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  head: () => ({
    meta: seo('teams'),
  }),
  pendingComponent: () => null,
  pendingMs: 0,
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

  const ability = useAbility();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const { isLoading: isMemberLoading } = useCurrentMemberContext(
    organizationId,
    isAuthLoading || !isAuthenticated,
  );
  const { data: count } = useApproxTeamCount(organizationId);
  const { teams } = useTeams();

  if (count === undefined) return null;

  if (
    !isAuthLoading &&
    !isMemberLoading &&
    ability.cannot('read', 'orgSettings')
  ) {
    return <AccessDenied message={t('teams')} />;
  }

  return <TeamsTable teams={teams} organizationId={organizationId} />;
}
