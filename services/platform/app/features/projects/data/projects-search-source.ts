'use client';

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

const NO_RESULTS: SearchResult<ProjectSearchHitData>[] = [];

export type ProjectSearchHitData = {
  kind: 'project';
};

export function createProjectsSearchSource(options: {
  organizationId: string;
  enabled?: boolean;
}): SearchSource<ProjectSearchHitData> {
  const { organizationId, enabled = true } = options;
  return (query, { active }) => {
    const trimmed = query.trim();
    const hits = useConvexQuery(
      api.projects.search.searchProjects,
      enabled && active && trimmed.length > 0
        ? { organizationId, query: trimmed }
        : 'skip',
      { staleTime: 0, gcTime: 0 },
    );

    const results = useMemo<SearchResult<ProjectSearchHitData>[]>(() => {
      if (!hits.data) return NO_RESULTS;
      return hits.data.map((hit) => ({
        id: hit.projectId,
        title: hit.key ? `${hit.key} · ${hit.name}` : hit.name,
        subtitle: hit.snippet,
        group: 'projects',
        data: { kind: 'project' as const },
      }));
    }, [hits.data]);

    if (!enabled || !active || trimmed.length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }
    return {
      results,
      status: hits.isLoading || hits.isFetching ? 'loading' : 'ready',
    };
  };
}
