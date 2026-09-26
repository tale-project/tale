'use client';

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';

const NO_RESULTS: SearchResult<ProjectSearchHitData>[] = [];

export type ProjectSearchHitData = {
  kind: 'project';
};

/** The palette snippet reads `KEY · description`; the title carries the
 * key, so the line under it keeps the description alone (or nothing). */
function withoutKey(snippet: string, key: string | undefined): string {
  if (key === undefined || key.length === 0) return snippet;
  if (snippet === key) return '';
  const prefix = `${key} · `;
  return snippet.startsWith(prefix) ? snippet.slice(prefix.length) : snippet;
}

export function createProjectsSearchSource(options: {
  organizationId: string;
  enabled?: boolean;
}): SearchSource<ProjectSearchHitData> {
  const { organizationId, enabled = true } = options;
  return (query, { active }) => {
    const { t } = useT('dialogs');
    const trimmed = query.trim();
    const hits = useBackendQuery(
      'projects/search:searchProjects',
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
        // The key already leads the title; underneath, only the description.
        subtitle: withoutKey(hit.snippet, hit.key),
        ...(hit.archived ? { badge: t('search.badgeArchived') } : {}),
        group: 'projects',
        data: { kind: 'project' as const },
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
