import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
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
    <SettingsPage>
      <GuardrailsOverview organizationId={organizationId} />
      <ChatFilterConfigView organizationId={organizationId} />
      <PiiConfig organizationId={organizationId} />
      <ModerationProviderConfigView organizationId={organizationId} />
    </SettingsPage>
  );
}
