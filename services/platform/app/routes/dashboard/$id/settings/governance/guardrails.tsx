import { createFileRoute } from '@tanstack/react-router';

import { ChatFilterConfigView } from '@/app/features/settings/governance/components/chat-filter-config';
import { GuardrailsOverview } from '@/app/features/settings/governance/components/guardrails-overview';
import { ModerationProviderConfigView } from '@/app/features/settings/governance/components/moderation-provider-config';
import { PiiConfig } from '@/app/features/settings/governance/components/pii-config';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/guardrails',
)({
  component: GuardrailsRoute,
});

function GuardrailsRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <div className="divide-border flex flex-col divide-y">
      <div className="pb-7">
        <GuardrailsOverview organizationId={organizationId} />
      </div>
      <div className="py-7">
        <ChatFilterConfigView organizationId={organizationId} />
      </div>
      <div className="py-7">
        <PiiConfig organizationId={organizationId} />
      </div>
      <div className="pt-7">
        <ModerationProviderConfigView organizationId={organizationId} />
      </div>
    </div>
  );
}
