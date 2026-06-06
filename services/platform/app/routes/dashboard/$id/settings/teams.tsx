import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { TeamsSettings } from '@/app/features/settings/teams/components/teams-settings';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  head: () => ({ meta: seo('teams') }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.listOrgTeams, {
        organizationId: params.id,
      }),
    );
  },
  component: TeamsPage,
});

function TeamsPage() {
  const { id: organizationId } = Route.useParams();

  return <TeamsSettings organizationId={organizationId} />;
}
