import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ProvidersPage } from '@/app/features/settings/providers/components/providers-page';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/providers')({
  head: () => ({
    meta: seo('providers'),
  }),
  component: ProvidersRoute,
});

function ProvidersRoute() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  return <ProvidersPage organizationId={organizationId} />;
}
