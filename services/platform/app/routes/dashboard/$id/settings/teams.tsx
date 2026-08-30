import { createFileRoute } from '@tanstack/react-router';

import { TeamsSettings } from '@/app/features/settings/teams/components/teams-settings';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  head: () => ({ meta: seo('teams') }),
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      api.members.queries.listOrgTeams,
      {
        organizationId: params.id,
      },
    );
  },
  component: TeamsPage,
});

function TeamsPage() {
  const { id: organizationId } = Route.useParams();

  return <TeamsSettings organizationId={organizationId} />;
}
