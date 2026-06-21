import { SectionHeader } from '@tale/ui/section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { AgentEnvEditor } from '@/app/features/agents/components/agent-env-editor';
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
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <SectionHeader
        title={t('agents.env.title')}
        description={t('agents.env.description')}
      />
      <FormSection>
        <AgentEnvEditor organizationId={organizationId} agentSlug={agentId} />
      </FormSection>
    </ContentArea>
  );
}
