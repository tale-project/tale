import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SystemPromptEditor } from '@/app/features/settings/governance/components/system-prompt-editor';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({
    meta: seo('governance'),
  }),
  component: GovernanceSettingsPage,
});

function GovernanceSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    return null;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('organization')} />;
  }

  return <SystemPromptEditor organizationId={organizationId} />;
}
