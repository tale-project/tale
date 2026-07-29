import { createFileRoute } from '@tanstack/react-router';

import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { ConversationAccessPolicyEditor } from '@/app/features/settings/governance/components/conversation-access-policy-editor';
import { ConversationRoutingPolicyEditor } from '@/app/features/settings/governance/components/conversation-routing-policy-editor';
import { FeatureFlagsEditor } from '@/app/features/settings/governance/components/feature-flags-editor';
import { PersonalizationPolicyEditor } from '@/app/features/settings/governance/components/personalization-policy-editor';
import { RetentionEditor } from '@/app/features/settings/governance/components/retention-editor';
import { SandboxQuotaEditor } from '@/app/features/settings/governance/components/sandbox-quota-editor';
import { UploadPolicyEditor } from '@/app/features/settings/governance/components/upload-policy-editor';
import { VoiceOutputPolicyEditor } from '@/app/features/settings/governance/components/voice-output-policy-editor';
import { ensureGovernancePolicies } from '@/app/lib/loader-preload';

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
      'sandbox_quota',
      'conversation_access',
      'conversation_routing',
    ]).catch((error: unknown) => {
      console.warn('Failed to preload policies-limits policies', error);
    }),
  component: PoliciesLimitsRoute,
});

function PoliciesLimitsRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <SettingsPage>
      <EditorGroup>
        <BudgetEditor organizationId={organizationId} />
        <UploadPolicyEditor organizationId={organizationId} />
        <RetentionEditor organizationId={organizationId} />
        <FeatureFlagsEditor organizationId={organizationId} />
        <PersonalizationPolicyEditor organizationId={organizationId} />
        <VoiceOutputPolicyEditor organizationId={organizationId} />
        <SandboxQuotaEditor organizationId={organizationId} />
        <ConversationAccessPolicyEditor organizationId={organizationId} />
        <ConversationRoutingPolicyEditor organizationId={organizationId} />
      </EditorGroup>
    </SettingsPage>
  );
}
