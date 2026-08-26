'use client';

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const NO_RESULTS: SearchResult<DocumentSearchHitData>[] = [];

export type DocumentSearchHitData = {
  kind: 'document';
  folderId?: Id<'folders'>;
  projectId?: Id<'projects'>;
};

export function createDocumentsSearchSource(options: {
  organizationId: string;
  enabled?: boolean;
}): SearchSource<DocumentSearchHitData> {
  const { organizationId, enabled = true } = options;
  return (query, { active }) => {
    const trimmed = query.trim();
    const hits = useConvexQuery(
      api.documents.search.searchDocuments,
      enabled && active && trimmed.length > 0
        ? { organizationId, query: trimmed }
        : 'skip',
      { staleTime: 0, gcTime: 0 },
    );

    const results = useMemo<SearchResult<DocumentSearchHitData>[]>(() => {
      if (!hits.data) return NO_RESULTS;
      return hits.data.map((hit) => ({
        id: hit.documentId,
        title: hit.title,
        subtitle: hit.snippet,
        group: 'documents',
        data: {
          kind: 'document' as const,
          folderId: hit.folderId,
          projectId: hit.projectId,
        },
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
