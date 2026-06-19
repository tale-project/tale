import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { createFileRoute } from '@tanstack/react-router';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

// Overview is the default Agents landing: the pre-wired company's delegation
// chart is the first thing a fresh org sees. The other views (Catalog, All
// agents, Metrics) are sibling tabs in the agents layout.
const OrganigramCanvas = lazyComponent(() =>
  import('@/app/features/agents/organigram/organigram-canvas').then((mod) => ({
    default: mod.OrganigramCanvas,
  })),
);

export const Route = createFileRoute('/dashboard/$id/agents/')({
  head: () => ({
    meta: seo('agents'),
  }),
  // The React Flow + ELK chunk is heavy — warm it during the loader.
  loader: () => {
    void import('@/app/features/agents/organigram/organigram-canvas');
  },
  component: AgentsOverviewPage,
});

function AgentsOverviewPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('organigram');
  const ability = useAbility();
  const canEdit = ability.can('read', 'developerSettings');

  return (
    <Stack gap={6} className="p-6">
      <SectionHeader title={t('title')} description={t('subtitle')} />
      <OrganigramCanvas organizationId={organizationId} canEdit={canEdit} />
    </Stack>
  );
}
