import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
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
 * Same page shape as the Organigram sibling: the agents layout's breadcrumb
 * ("Agents › Catalog") is the way back, so the content opens with a plain
 * title block.
 */
function AgentCatalogPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('agentCatalog');

  return (
    <Stack gap={6} className="p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">{t('title')}</h1>
        <Text variant="caption" className="text-muted-foreground text-sm">
          {t('subtitle')}
        </Text>
      </div>
      <AgentCatalog organizationId={organizationId} />
    </Stack>
  );
}
