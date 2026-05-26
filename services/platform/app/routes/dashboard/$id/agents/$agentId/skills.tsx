import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { useListSkills } from '@/app/features/skills/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { MAX_SKILL_BINDINGS_PER_AGENT } from '@/lib/shared/schemas/agents';
import { seo } from '@/lib/utils/seo';

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
  const { skills, isLoading } = useListSkills(organizationId);

  // Auto-prune stale slugs: SkillsTable rows are driven by the org listing,
  // so a slug present in `selected` but absent from the listing renders no
  // row yet still occupies the cap. Reconcile on mount/listing change so
  // the counter and cap pressure track the visible rows. Guard against
  // wiping bindings on the loading or error path (empty `skills`).
  useEffect(() => {
    if (isLoading || !Array.isArray(skills) || skills.length === 0) return;
    const allowed = new Set(
      skills.filter((s) => !('status' in s)).map((s) => s.slug),
    );
    const pruned = selected.filter((s) => allowed.has(s));
    if (pruned.length !== selected.length) {
      updateConfig({ skillBindings: pruned });
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- intentional: prune on org skill-set change, not on every selected/updateConfig identity flip
  }, [skills, isLoading]);

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
          max: MAX_SKILL_BINDINGS_PER_AGENT,
        }}
      />
    </ContentArea>
  );
}
