import { useCallback } from 'react';

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
  /** Legacy free-form string; superseded by `categoryId` once migrated. */
  category?: string;
  categoryId?: Id<'promptCategories'>;
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
  /** Legacy free-form string; superseded by `categoryId` once migrated. */
  category?: string;
  categoryId?: Id<'promptCategories'>;
  tags?: string[];
  usageCount: number;
  sourceMessageId?: string;
  version?: number;
  /** Only present in `getPrompt` detail for creator/admin viewers. */
  versionHistory?: PromptVersionStoredEntry[];
}

export interface PromptCategory {
  _id: Id<'promptCategories'>;
  _creationTime: number;
  organizationId: string;
  scope: 'global' | 'team' | 'personal';
  teamId?: string;
  createdBy: string;
  name: string;
  nameLower: string;
}

export interface CategoriesBucketed {
  personal: PromptCategory[];
  team: PromptCategory[];
  global: PromptCategory[];
}

interface UsePromptsOptions {
  scope?: 'global' | 'team' | 'personal';
  search?: string;
  /** Legacy string filter; clients should prefer `categoryIds`. */
  categories?: string[];
  categoryIds?: Id<'promptCategories'>[];
  tags?: string[];
}

export function usePrompts(
  organizationId: string,
  options: UsePromptsOptions = {},
) {
  // Cast bridges Convex's auto-inferred `FunctionReference` for a paginated
  // query to `useCachedPaginatedQuery`'s `PaginatedQueryReference` parameter
  // slot — they're structurally compatible but the generated type doesn't
  // assign cleanly. Not related to runtime arg shapes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const listPromptsQuery = api.prompts.queries
    .listPrompts as unknown as Parameters<typeof useCachedPaginatedQuery>[0];
  const queryArgs = organizationId
    ? {
        organizationId,
        scope: options.scope,
        search: options.search,
        categories:
          options.categories && options.categories.length > 0
            ? options.categories
            : undefined,
        categoryIds:
          options.categoryIds && options.categoryIds.length > 0
            ? options.categoryIds
            : undefined,
        tags:
          options.tags && options.tags.length > 0 ? options.tags : undefined,
      }
    : ('skip' as const);
  const { results, status, loadMore, isLoading } = useCachedPaginatedQuery(
    listPromptsQuery,
    queryArgs,
    { initialNumItems: PROMPTS_PAGE_SIZE },
  );

  const prompts: PromptTemplate[] = results ?? [];

  // Memoize so consumers can place this in `useEffect` deps without
  // triggering infinite re-runs.
  const stableLoadMore = useCallback(
    () => loadMore(PROMPTS_PAGE_SIZE),
    [loadMore],
  );

  return {
    prompts,
    isLoading,
    canLoadMore: status === 'CanLoadMore',
    isLoadingMore: status === 'LoadingMore',
    loadMore: stableLoadMore,
  };
}

export function usePromptFacets(organizationId: string | undefined) {
  return useConvexQuery(
    api.prompts.queries.listPromptFacets,
    organizationId ? { organizationId } : 'skip',
    { enabled: !!organizationId },
  );
}

/**
 * Categories the caller can see, bucketed by scope. The picker calls
 * this once and filters in memory by the form's currently-selected
 * scope (and teamId for team-scope prompts).
 */
export function useCategories(organizationId: string | undefined) {
  return useConvexQuery(
    api.prompts.categories.listCategories,
    organizationId ? { organizationId } : 'skip',
    { enabled: !!organizationId },
  );
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
 * Lookup of {promptId, sourceMessageId} pairs for the caller's saved prompts
 * matching the currently-rendered chat messages. Pass the visible message ids
 * so the wire payload is O(visible messages), not O(save-history).
 *
 * Skipped when no organizationId or when there are no message ids to look up.
 */
export function useSavedSourceMessageIds(
  organizationId: string | undefined,
  sourceMessageIds: readonly string[],
) {
  const enabled = organizationId !== undefined && sourceMessageIds.length > 0;
  return useConvexQuery(
    api.prompts.queries.getSavedSourceMessageIds,
    enabled
      ? {
          organizationId,
          sourceMessageIds: [...sourceMessageIds],
        }
      : 'skip',
    { enabled },
  );
}
