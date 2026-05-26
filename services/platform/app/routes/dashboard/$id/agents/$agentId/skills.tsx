import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const MAX_SKILL_BINDINGS = 10;

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/skills')({
  head: () => ({
    meta: seo('agentSkills'),
  }),
  component: SkillsTab,
});

function SkillsTab() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();

  const selected = config.skillBindings ?? [];

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.form.sectionSkillBindings')}
        description={t('agents.form.sectionSkillBindingsDescription')}
      />
      <SkillsTable
        organizationId={organizationId}
        hideActionMenu
        bindingMode={{
          selected,
          onChange: (skillBindings) => updateConfig({ skillBindings }),
          max: MAX_SKILL_BINDINGS,
        }}
      />
    </ContentArea>
  );
}
