import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { AgentEnvEditor } from '@/app/features/agents/components/agent-env-editor';
import { AgentTabContent } from '@/app/features/agents/components/agent-tab-content';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/environment',
)({
  head: () => ({
    meta: seo('agentSettings'),
  }),
  component: EnvironmentTab,
});

function EnvironmentTab() {
  const { t } = useT('settings');
  // `agentId` is the decoded slug (app agents carry a composite `<app>/<name>`);
  // it is the `agentEnv` key the editor writes against.
  const { id: organizationId, agentId } = Route.useParams();

  return (
    <AgentTabContent>
      {/* No tab-level heading — the tab strip already names the tab (the same
          no-page-title rule as settings pages); the description leads alone. */}
      <Text variant="muted" className="text-sm">
        {t('agents.env.description')}
      </Text>
      <FormSection>
        <AgentEnvEditor organizationId={organizationId} agentSlug={agentId} />
      </FormSection>
    </AgentTabContent>
  );
}
