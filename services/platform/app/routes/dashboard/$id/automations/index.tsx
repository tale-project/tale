import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { PageLayout } from '@tale/ui/page-layout';
import { createFileRoute } from '@tanstack/react-router';

import { AutomationsList } from '@/app/features/automations/components/automations-list';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  head: () => ({
    meta: seo('automations'),
  }),
  loader: ({ context, params }) => {
    // Warm the listing so the table paints without a skeleton on first nav.
    // The args MUST match what `AutomationsList` subscribes with on the org
    // page (project-bound automations merged in) or the cache key misses.
    prefetchAdaptedQuery(
      context.queryClient,
      'automations/queries:listAutomations',
      { organizationId: params.id, includeProjectBound: true },
    );
  },
  component: AutomationsPage,
});

/**
 * The Automations list — the same shell as the Projects list: the page owns
 * its layout, and the title row ends in the section divider because no tab
 * strip follows it.
 */
function AutomationsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot showBorder standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <AutomationsList organizationId={organizationId} />
    </PageLayout>
  );
}
