import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ProvidersPageSkeleton } from '@/app/features/settings/providers/components/providers-page-skeleton';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/providers')({
  head: () => ({
    meta: seo('providers'),
  }),
  component: ProvidersLayout,
});

function ProvidersLayout() {
  const { t } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    return <ProvidersPageSkeleton />;
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  return <Outlet />;
}
