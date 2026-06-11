import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { KnowledgeEntryItem } from '@/convex/knowledge_entries/queries';

export type { KnowledgeEntryItem };

export function useApproxKnowledgeEntryCount(organizationId: string) {
  return useConvexQuery(
    api.knowledge_entries.queries.approxCountKnowledgeEntries,
    { organizationId },
  );
}

interface ListKnowledgeEntriesPaginatedArgs {
  organizationId: string;
  initialNumItems: number;
}

export function useListKnowledgeEntriesPaginated(
  args: ListKnowledgeEntriesPaginatedArgs,
) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.knowledge_entries.queries.listKnowledgeEntriesPaginated,
    queryArgs,
    { initialNumItems },
  );
}

export function useKnowledgeEntryVersions(
  entryId: Id<'knowledgeEntries'> | undefined,
) {
  return useConvexQuery(
    api.knowledge_entries.queries.getKnowledgeEntryVersions,
    entryId ? { entryId } : 'skip',
  );
}
