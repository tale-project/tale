import { createFileRoute } from '@tanstack/react-router';

import { KnowledgeEntriesTable } from '@/app/features/knowledge-entries/components/knowledge-entries-table';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
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
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror
    // useListKnowledgeEntriesPaginated's base args.
  },
  component: KnowledgeEntriesPage,
});

function KnowledgeEntriesPage() {
  const { id: organizationId } = Route.useParams();

  return <KnowledgeEntriesTable organizationId={organizationId} />;
}
