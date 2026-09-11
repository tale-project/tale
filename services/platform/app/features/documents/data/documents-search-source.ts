'use client';

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';

const NO_RESULTS: SearchResult<DocumentSearchHitData>[] = [];

export type DocumentSearchHitData = {
  kind: 'document';
  folderId?: string;
  projectId?: string;
};

export function createDocumentsSearchSource(options: {
  organizationId: string;
  enabled?: boolean;
}): SearchSource<DocumentSearchHitData> {
  const { organizationId, enabled = true } = options;
  return (query, { active }) => {
    const { t } = useT('dialogs');
    const trimmed = query.trim();
    const hits = useBackendQuery(
      'documents/search:searchDocuments',
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
        // A document has no archive state of its own; its project's is the
        // only label it can carry (#3007).
        ...(hit.projectArchived
          ? { badge: t('search.badgeProjectArchived') }
          : {}),
        group: 'documents',
        data: {
          kind: 'document' as const,
          folderId: hit.folderId,
          projectId: hit.projectId,
        },
      }));
    }, [hits.data, t]);

    if (!enabled || !active || trimmed.length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }
    return {
      results,
      status: hits.isLoading || hits.isFetching ? 'loading' : 'ready',
    };
  };
}
