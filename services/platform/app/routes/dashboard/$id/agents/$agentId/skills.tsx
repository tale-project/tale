import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { SkillSelector } from '@/app/features/agents/components/skill-selector';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/skills')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsTab,
});

function SkillsTab() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.skills.title', { defaultValue: 'Skills' })}
        description={t('agents.skills.description', {
          defaultValue:
            "Bind reusable instruction bundles to this agent. Each skill's declared tool / integration / workflow dependencies are snapshot at bind time and merged into the agent's effective set at runtime.",
        })}
      />

      <PageSection
        gap={3}
        title={t('agents.skills.boundTitle', {
          defaultValue: 'Bound skills',
        })}
        description={t('agents.skills.boundDescription', {
          defaultValue:
            "When the agent runs, each bound skill's name + description is injected into the system prompt. The model can call expand_skill to load full instructions, read_skill_file for large assets, and skill_run to execute bundled scripts in the sandbox.",
        })}
      >
        <SkillSelector
          organizationId={organizationId}
          value={config.skillBindings ?? []}
          resolvedSnapshot={config.skillBindingsResolved}
          onChange={(skillBindings, skillBindingsResolved) =>
            updateConfig({ skillBindings, skillBindingsResolved })
          }
        />
      </PageSection>
    </ContentArea>
  );
}
