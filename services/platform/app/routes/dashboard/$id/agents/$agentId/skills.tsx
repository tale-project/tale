import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { PageHeader } from '@/app/components/layout/page-header';
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

  const selected = useMemo(
    () => config.skillBindings ?? [],
    [config.skillBindings],
  );
  const { skills, isLoading } = useListSkills(organizationId);

  // Render-layer prune: stale slugs (bound to skills the org no longer has)
  // are hidden from the binding UI without mutating `config.skillBindings`.
  // Keeping the prune off the write path means opening this tab never marks
  // the form dirty — only an actual user toggle does. Runtime
  // `buildSkillContext` already intersects bindings with live org skills, so
  // stale entries in the JSON have no functional effect until the user
  // touches the form and the next save naturally cleans them up.
  const allowed = useMemo(
    () =>
      new Set(
        Array.isArray(skills)
          ? skills.filter((s) => !('status' in s)).map((s) => s.slug)
          : [],
      ),
    [skills],
  );
  const visibleSelected = useMemo(
    () => (isLoading ? selected : selected.filter((s) => allowed.has(s))),
    [isLoading, selected, allowed],
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <PageHeader
        as="h2"
        title={t('agents.form.sectionSkillBindings')}
        description={t('agents.form.sectionSkillBindingsDescription')}
      />
      <SkillsTable
        organizationId={organizationId}
        hideActionMenu
        bindingMode={{
          selected: visibleSelected,
          onChange: (skillBindings) => updateConfig({ skillBindings }),
          max: MAX_SKILL_BINDINGS_PER_AGENT,
        }}
        emptyStateOverride={{
          description: (
            <VStack gap={2} align="center">
              <Text variant="muted">
                {t('agents.form.skillBindingsNoSkillsInOrgDescription', {
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
