import { SectionHeader } from '@tale/ui/section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const OrganigramCanvas = lazyComponent(() =>
  import('@/app/features/agents/organigram/organigram-canvas').then((mod) => ({
    default: mod.OrganigramCanvas,
  })),
);

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/delegation',
)({
  head: () => ({
    meta: seo('agentDelegation'),
  }),
  // Warm the React Flow chunk during the loader (it's heavy).
  loader: () => {
    void import('@/app/features/agents/organigram/organigram-canvas');
  },
  component: DelegationTab,
});

/**
 * Delegation IS the organigram: who this agent can delegate to is exactly
 * its direct reports on the org chart, so this tab renders the chart editor
 * with the agent pre-selected. There is no per-agent delegate list.
 */
function DelegationTab() {
  const { t } = useT('settings');
  const { id: organizationId } = Route.useParams();
  const { agentName } = useAgentConfig();
  const ability = useAbility();
  const canEdit = ability.can('read', 'developerSettings');

  return (
    <ContentArea gap={6} className="py-4">
      <SectionHeader
        title={t('agents.delegation.title')}
        description={t('agents.delegation.description')}
      />
      <OrganigramCanvas
        organizationId={organizationId}
        canEdit={canEdit}
        focusSlug={agentName}
      />
    </ContentArea>
  );
}
