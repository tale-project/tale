import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TeamsTable } from '@/app/features/settings/teams/components/teams-table';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
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
  },
  component: TeamsSettingsPage,
});

function TeamsSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();

  const { teams } = useTeams();

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('teams')} />;
  }

  return <TeamsTable teams={teams} organizationId={organizationId} />;
}
