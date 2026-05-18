import { createFileRoute } from '@tanstack/react-router';

import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { FeatureFlagsEditor } from '@/app/features/settings/governance/components/feature-flags-editor';
import { RetentionEditor } from '@/app/features/settings/governance/components/retention-editor';
import { VoiceOutputPolicyEditor } from '@/app/features/settings/governance/components/voice-output-policy-editor';
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

  return (
    <div className="divide-border flex flex-col divide-y">
      <div className="pb-7">
        <BudgetEditor organizationId={organizationId} />
      </div>
      <div className="py-7">
        <UploadPolicyEditor organizationId={organizationId} />
      </div>
      <div className="py-7">
        <RetentionEditor organizationId={organizationId} />
      </div>
      <div className="py-7">
        <FeatureFlagsEditor organizationId={organizationId} />
      </div>
      <div className="pt-7">
        <VoiceOutputPolicyEditor organizationId={organizationId} />
      </div>
    </div>
  );
}
