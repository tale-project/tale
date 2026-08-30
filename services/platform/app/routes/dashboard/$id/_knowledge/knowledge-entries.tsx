import { createFileRoute } from '@tanstack/react-router';

import { KnowledgeEntriesTable } from '@/app/features/knowledge-entries/components/knowledge-entries-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { api } from '@/convex/_generated/api';
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
      api.knowledge_entries.queries.approxCountKnowledgeEntries,
      {
        organizationId: params.id,
      },
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror
    // useListKnowledgeEntriesPaginated's base args.
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.knowledge_entries.queries.listKnowledgeEntriesPaginated,
      { organizationId: params.id },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: KnowledgeEntriesPage,
});

function KnowledgeEntriesPage() {
  const { id: organizationId } = Route.useParams();

  return <KnowledgeEntriesTable organizationId={organizationId} />;
}
