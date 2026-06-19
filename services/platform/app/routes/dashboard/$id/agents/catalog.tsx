import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { createFileRoute } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const AgentCatalog = lazyComponent(() =>
  import('@/app/features/agents/components/agent-catalog').then((mod) => ({
    default: mod.AgentCatalog,
  })),
);

export const Route = createFileRoute('/dashboard/$id/agents/catalog')({
  head: () => ({
    meta: seo('agents'),
  }),
  loader: () => {
    void import('@/app/features/agents/components/agent-catalog');
  },
  component: AgentCatalogPage,
});

/**
 * Same page shape as the Overview sibling: the agents layout owns the page
 * <h1> + tab strip, so the content opens with a section title block.
 */
function AgentCatalogPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('agentCatalog');

  return (
    <Stack gap={6} className="p-6">
      <SectionHeader title={t('title')} description={t('subtitle')} />
      <AgentCatalog organizationId={organizationId} />
    </Stack>
  );
}
