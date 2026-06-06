import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { OrganizationSettings } from '@/app/features/settings/organization/components/organization-settings';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/organization')({
  head: () => ({
    meta: seo('organization'),
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.organizations.queries.getOrganization, {
        id: params.id,
      }),
    );
    // The page now embeds the Members section, so warm its list alongside
    // the org details for an instant table on first paint.
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.listByOrganization, {
        organizationId: params.id,
      }),
    );
  },
  component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
  const { id: organizationId } = Route.useParams();
  // The container owns loading + access + the skeletonized view, so the
  // skeleton IS the real `SettingsPage narrow` layout (matched centering).
  return <OrganizationSettings organizationId={organizationId} />;
}
