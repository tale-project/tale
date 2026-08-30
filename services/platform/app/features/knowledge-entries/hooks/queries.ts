import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { PageItemOf } from '@/app/lib/backend/contract';

/** One knowledge entry as the table renders it. */
export type KnowledgeEntryItem =
  PageItemOf<'knowledge_entries/queries:listKnowledgeEntriesPaginated'>;

export function useApproxKnowledgeEntryCount(organizationId: string) {
  return useConvexQuery(
    'knowledge_entries/queries:approxCountKnowledgeEntries',
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
    'knowledge_entries/queries:listKnowledgeEntriesPaginated',
    queryArgs,
    { initialNumItems },
  );
}

export function useKnowledgeEntryVersions(entryId: string | undefined) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    'knowledge_entries/queries:getKnowledgeEntryVersions',
    entryId && organizationId ? { entryId, organizationId } : 'skip',
  );
}
