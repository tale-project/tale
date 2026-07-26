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
  },
  component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
  const { id: organizationId } = Route.useParams();
  // The container owns loading + access + the skeletonized view, so the
  // skeleton IS the real `SettingsPage` layout.
  return <OrganizationSettings organizationId={organizationId} />;
}
