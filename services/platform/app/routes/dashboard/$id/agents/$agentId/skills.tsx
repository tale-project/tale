import { HStack, VStack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { useListSkills } from '@/app/features/skills/hooks/queries';
import { WORKFLOW_SKILL_NAMES } from '@/convex/lib/skills/guidance';
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

  const isExternalAgent = config.primaryBehavior === 'external-agent';
  const workflowSlugs = useMemo(
    () => new Set<string>(WORKFLOW_SKILL_NAMES),
    [],
  );

  const selected = useMemo(
    () => config.skillBindings ?? [],
    [config.skillBindings],
  );
  const { skills, isLoading } = useListSkills(organizationId);

  const allowed = useMemo(
    () =>
      new Set(
        Array.isArray(skills)
          ? skills
              .filter((s) => !('status' in s))
              .filter((s) => !isExternalAgent || !workflowSlugs.has(s.slug))
              .map((s) => s.slug)
          : [],
      ),
    [skills, isExternalAgent, workflowSlugs],
  );
  const visibleSelected = useMemo(
    () => (isLoading ? selected : selected.filter((s) => allowed.has(s))),
    [isLoading, selected, allowed],
  );

  const sectionDescription = isExternalAgent
    ? t('agents.form.sectionSkillBindingsExternalDescription')
    : t('agents.form.sectionSkillBindingsDescription');

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('agents.form.sectionSkillBindings')}
        description={sectionDescription}
      />
      <SkillsTable
        organizationId={organizationId}
        excludeSlugs={isExternalAgent ? workflowSlugs : undefined}
        bindingMode={{
          selected: visibleSelected,
          onChange: (skillBindings) => updateConfig({ skillBindings }),
          max: MAX_SKILL_BINDINGS_PER_AGENT,
        }}
        emptyStateOverride={{
          description: (
            <VStack gap={2} align="center">
              <Text variant="muted">
                {isExternalAgent
                  ? t(
                      'agents.form.skillBindingsExternalNoCustomSkillsDescription',
                    )
                  : t('agents.form.skillBindingsNoSkillsInOrgDescription', {
                      defaultValue: 'No skills exist in this organization yet.',
                    })}
              </Text>
              <Link
                to="/dashboard/$id/settings/skills"
                params={{ id: organizationId }}
                className="text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium"
              >
                <HStack gap={1} align="center">
                  {t('agents.form.skillBindingsNoSkillsInOrgCta', {
                    defaultValue: 'Create one in Skills settings',
                  })}
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </HStack>
              </Link>
            </VStack>
          ),
        }}
      />
    </ContentArea>
  );
}
