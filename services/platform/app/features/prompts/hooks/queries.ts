import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const PROMPTS_PAGE_SIZE = 30;

export interface PromptVersionEntry {
  version: number;
  content: string;
  publishedAt: number;
  publishedBy: string;
  /** Server-resolved display name; `null` when the user can't be resolved. */
  publishedByName: string | null;
}

export interface PromptTemplate {
  _id: Id<'promptTemplates'>;
  _creationTime: number;
  organizationId: string;
  createdBy: string;
  title: string;
  content: string;
  description?: string;
  scope: 'global' | 'team' | 'personal';
  teamId?: string;
  category?: string;
  tags?: string[];
  usageCount: number;
  /** @deprecated */
  isPublished?: boolean;
  sourceMessageId?: string;
  version?: number;
  /** Only present in `getPrompt` detail for creator/admin viewers. */
  versionHistory?: PromptVersionEntry[];
}

export function usePrompts(organizationId: string) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- paginationOpts is optional to handle Convex reconnection replays; usePaginatedQuery always provides it at runtime
  const listPromptsQuery = api.prompts.queries
    .listPrompts as unknown as Parameters<typeof useCachedPaginatedQuery>[0];
  const queryArgs = organizationId ? { organizationId } : ('skip' as const);
  const { results, status, loadMore, isLoading } = useCachedPaginatedQuery(
    listPromptsQuery,
    queryArgs,
    { initialNumItems: PROMPTS_PAGE_SIZE },
  );

  const prompts: PromptTemplate[] = results ?? [];

  return {
    prompts,
    isLoading,
    canLoadMore: status === 'CanLoadMore',
    isLoadingMore: status === 'LoadingMore',
    loadMore: () => loadMore(PROMPTS_PAGE_SIZE),
  };
}

export function usePrompt(promptId: Id<'promptTemplates'> | undefined) {
  return useConvexQuery(
    api.prompts.queries.getPrompt,
    promptId ? { promptId } : 'skip',
    { enabled: !!promptId },
  );
}

export function usePromptHistory(promptId: Id<'promptTemplates'> | undefined) {
  return useConvexQuery(
    api.prompts.queries.getPromptHistory,
    promptId ? { promptId } : 'skip',
    { enabled: !!promptId },
  );
}
