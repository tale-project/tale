import { createFileRoute } from '@tanstack/react-router';

import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ChatFilterConfigView } from '@/app/features/settings/governance/components/chat-filter-config';
import { GuardrailsOverview } from '@/app/features/settings/governance/components/guardrails-overview';
import { ModerationProviderConfigView } from '@/app/features/settings/governance/components/moderation-provider-config';
import { PiiConfig } from '@/app/features/settings/governance/components/pii-config';
import { SystemPromptEditor } from '@/app/features/settings/governance/components/system-prompt-editor';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/guardrails',
)({
  component: GuardrailsRoute,
});

function GuardrailsRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <SettingsPage>
      <EditorGroup>
        <GuardrailsOverview organizationId={organizationId} />
        {/* The org's mandatory custom instructions are a guardrail — they
            constrain every agent — so they sit with the other content
            controls rather than among model selection. */}
        <SystemPromptEditor organizationId={organizationId} />
        <ChatFilterConfigView organizationId={organizationId} />
        <PiiConfig organizationId={organizationId} />
        <ModerationProviderConfigView organizationId={organizationId} />
      </EditorGroup>
    </SettingsPage>
  );
}
