import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { FeatureFlagsEditor } from '@/app/features/settings/governance/components/feature-flags-editor';
import { PersonalizationPolicyEditor } from '@/app/features/settings/governance/components/personalization-policy-editor';
import { RetentionEditor } from '@/app/features/settings/governance/components/retention-editor';
import { UploadPolicyEditor } from '@/app/features/settings/governance/components/upload-policy-editor';
import { VoiceOutputPolicyEditor } from '@/app/features/settings/governance/components/voice-output-policy-editor';
import { ensureGovernancePolicies } from '@/app/lib/loader-preload';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/policies-limits',
)({
  // Warm every policy the six editors on this page read, so they paint real
  // content on first render (no skeleton flash, no staggered reveal).
  loader: ({ context, params }) =>
    ensureGovernancePolicies(context, params.id, [
      'budgets',
      'upload_policy',
      'retention_policy',
      'feature_flags',
      'custom_instructions',
      'user_memories',
      'voice_output',
    ]).catch((error: unknown) => {
      console.warn('Failed to preload policies-limits policies', error);
    }),
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
      <PersonalizationPolicyEditor organizationId={organizationId} />
      <VoiceOutputPolicyEditor organizationId={organizationId} />
    </SettingsPage>
  );
}
