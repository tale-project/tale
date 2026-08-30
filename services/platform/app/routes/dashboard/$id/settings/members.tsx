import { createFileRoute } from '@tanstack/react-router';

import { MembersPage } from '@/app/features/settings/organization/components/members-page';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/members')({
  head: () => ({ meta: seo('members') }),
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      'members/queries:listByOrganization',
      {
        organizationId: params.id,
      },
    );
  },
  component: MembersSettingsPage,
});

function MembersSettingsPage() {
  const { id: organizationId } = Route.useParams();

  return <MembersPage organizationId={organizationId} />;
}
