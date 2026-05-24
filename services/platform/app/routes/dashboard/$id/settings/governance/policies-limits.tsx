import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { FeatureFlagsEditor } from '@/app/features/settings/governance/components/feature-flags-editor';
import { RetentionEditor } from '@/app/features/settings/governance/components/retention-editor';
import { VoiceOutputPolicyEditor } from '@/app/features/settings/governance/components/voice-output-policy-editor';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

const UploadPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/upload-policy-editor').then(
    (m) => ({ default: m.UploadPolicyEditor }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/policies-limits',
)({
  component: PoliciesLimitsRoute,
});

function PoliciesLimitsRoute() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('governance');

  return (
    <SettingsPage
      title={t('groups.policiesAndLimits')}
      description={t('groups.policiesAndLimitsDescription')}
    >
      <BudgetEditor organizationId={organizationId} />
      <UploadPolicyEditor organizationId={organizationId} />
      <RetentionEditor organizationId={organizationId} />
      <FeatureFlagsEditor organizationId={organizationId} />
      <VoiceOutputPolicyEditor organizationId={organizationId} />
    </SettingsPage>
  );
}
