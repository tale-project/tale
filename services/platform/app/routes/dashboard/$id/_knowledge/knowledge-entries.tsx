import { createFileRoute } from '@tanstack/react-router';

import { KnowledgeEntriesTable } from '@/app/features/knowledge-entries/components/knowledge-entries-table';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import {
  prefetchAdaptedPaginatedQuery,
  prefetchAdaptedQuery,
} from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/_knowledge/knowledge-entries',
)({
  head: () => ({
    meta: seo('knowledgeEntries'),
  }),
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      'knowledge_entries/queries:approxCountKnowledgeEntries',
      {
        organizationId: params.id,
      },
    );
    // Prime the first page of the list, under the key the table reads, so a
    // first visit paints its rows without skeleton rows. The tab strip preloads
    // this route as it renders, so the page is usually in the cache before the
    // tab is clicked. The args are useListKnowledgeEntriesPaginated's on a
    // visit with no filter in the URL, which is how a tab opens.
    prefetchAdaptedPaginatedQuery(
      context.queryClient,
      'knowledge_entries/queries:listKnowledgeEntriesPaginated',
      { organizationId: params.id },
      DEFAULT_TABLE_PAGE_SIZE,
    );
  },
  component: KnowledgeEntriesPage,
});

function KnowledgeEntriesPage() {
  const { id: organizationId } = Route.useParams();

  return <KnowledgeEntriesTable organizationId={organizationId} />;
}
