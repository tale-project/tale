import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { MembersPage } from '@/app/features/settings/organization/components/members-page';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/members')({
  head: () => ({ meta: seo('members') }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.listByOrganization, {
        organizationId: params.id,
      }),
    );
  },
  component: MembersSettingsPage,
});

function MembersSettingsPage() {
  const { id: organizationId } = Route.useParams();

  return <MembersPage organizationId={organizationId} />;
}
