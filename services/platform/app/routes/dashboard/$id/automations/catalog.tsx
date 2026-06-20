import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { AutomationsCatalog } from '@/app/features/automations/components/automations-catalog';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations/catalog')({
  head: () => ({
    meta: seo('automations'),
  }),
  component: AutomationsCatalogPage,
});

function AutomationsCatalogPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    return <div className="p-4" />;
  }

  if (ability.cannot('write', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return <AutomationsCatalog organizationId={organizationId} />;
}
