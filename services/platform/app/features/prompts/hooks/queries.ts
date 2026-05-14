import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const PROMPTS_PAGE_SIZE = 30;

/**
 * Stored shape (matches versionHistory[] entries on the row). Each entry
 * snapshots the row's full state at that version so restore re-applies
 * content AND metadata, not just content.
 */
interface PromptVersionStoredEntry {
  version: number;
  content: string;
  publishedAt: number;
  publishedBy: string;
  publishNote?: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  scope: 'global' | 'team' | 'personal';
  teamId?: string;
}

/**
 * History-API shape returned by `getPromptHistory`. Wraps the stored entry
 * with a server-resolved `publishedByName` so the UI doesn't have to do an
 * N+1 user lookup.
 */
export interface PromptVersionEntry extends PromptVersionStoredEntry {
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
  sourceMessageId?: string;
  version?: number;
  /** Only present in `getPrompt` detail for creator/admin viewers. */
  versionHistory?: PromptVersionStoredEntry[];
}

interface UsePromptsOptions {
  scope?: 'global' | 'team' | 'personal';
  searchPrefix?: string;
}

export function usePrompts(
  organizationId: string,
  options: UsePromptsOptions = {},
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- paginationOpts is optional to handle Convex reconnection replays; usePaginatedQuery always provides it at runtime
  const listPromptsQuery = api.prompts.queries
    .listPrompts as unknown as Parameters<typeof useCachedPaginatedQuery>[0];
  const queryArgs = organizationId
    ? {
        organizationId,
        scope: options.scope,
        searchPrefix: options.searchPrefix,
      }
    : ('skip' as const);
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

/**
 * Lookup of {promptId, sourceMessageId} pairs for the caller's saved prompts.
 * Lightweight (no content/metadata), bounded by the user's save history —
 * safe to fetch all in one shot. Used by the chat to render "saved" badges
 * on messages without missing rows past page 1 of usePrompts.
 */
export function useSavedSourceMessageIds(organizationId: string | undefined) {
  return useConvexQuery(
    api.prompts.queries.getSavedSourceMessageIds,
    organizationId ? { organizationId } : 'skip',
    { enabled: !!organizationId },
  );
}
