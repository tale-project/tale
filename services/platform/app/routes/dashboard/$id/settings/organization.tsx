import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { OrganizationPageSkeleton } from '@/app/features/settings/organization/components/organization-page-skeleton';
import { OrganizationSettings } from '@/app/features/settings/organization/components/organization-settings';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
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
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);

  if (abilityLoading || isOrgLoading) {
    return <OrganizationPageSkeleton />;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('organization')} />;
  }

  if (!organization) {
    return null;
  }

  return <OrganizationSettings organization={organization} />;
}
