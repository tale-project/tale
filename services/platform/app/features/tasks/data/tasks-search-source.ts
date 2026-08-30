'use client';

/**
 * The ⌘K palette's tasks source: readable project tasks, matched by title,
 * description, external id, KEY-number, or recent discussion comments through
 * `"tasks/search:searchTasks"`.
 *
 * Shaped like the chat source (`createChatSearchSource`): the factory is
 * memoised at the call site so the hook-shaped source keeps one identity —
 * the SearchCommand calls it every render and its inner hooks must run in a
 * stable order. Results opt out of the session cache: yesterday's hits
 * replaying under a new query would flash wrong rows.
 */

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { formatTaskIdentifier } from '@/lib/shared/project_key';

const NO_RESULTS: SearchResult<TaskSearchHitData>[] = [];

export type TaskSearchHitData = {
  kind: 'task';
  projectId: string;
};

export function createTasksSearchSource(options: {
  organizationId: string;
  /** When set, narrows to one project (Tasks toolbar / project-scoped palette). */
  projectId?: string;
}): SearchSource<TaskSearchHitData> {
  const { organizationId, projectId } = options;
  return (query, { active }) => {
    const trimmed = query.trim();
    const hits = useBackendQuery(
      'tasks/search:searchTasks',
      active && trimmed.length > 0
        ? {
            organizationId,
            query: trimmed,
            ...(projectId !== undefined ? { projectId } : {}),
          }
        : 'skip',
      { staleTime: 0, gcTime: 0 },
    );

    const results = useMemo<SearchResult<TaskSearchHitData>[]>(() => {
      if (!hits.data) return NO_RESULTS;
      return hits.data.map((hit) => {
        const identifier = formatTaskIdentifier(hit.projectKey, hit.number);
        return {
          id: hit.taskId,
          title: identifier ? `${identifier} · ${hit.title}` : hit.title,
          subtitle: hit.snippet,
          group: 'tasks',
          data: { kind: 'task' as const, projectId: hit.projectId },
        };
      });
    }, [hits.data]);

    if (!active || trimmed.length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }
    return {
      results,
      status: hits.isLoading || hits.isFetching ? 'loading' : 'ready',
    };
  };
}
