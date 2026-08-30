'use client';

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';

const NO_RESULTS: SearchResult<ContactSearchHitData>[] = [];

export type ContactSearchHitData = {
  kind: 'contact';
};

export function createContactsSearchSource(options: {
  organizationId: string;
  enabled?: boolean;
}): SearchSource<ContactSearchHitData> {
  const { organizationId, enabled = true } = options;
  return (query, { active }) => {
    const trimmed = query.trim();
    const hits = useBackendQuery(
      'contacts/search:searchContacts',
      enabled && active && trimmed.length > 0
        ? { organizationId, query: trimmed }
        : 'skip',
      { staleTime: 0, gcTime: 0 },
    );

    const results = useMemo<SearchResult<ContactSearchHitData>[]>(() => {
      if (!hits.data) return NO_RESULTS;
      return hits.data.map((hit) => ({
        id: hit.contactId,
        title: hit.name,
        subtitle: hit.snippet,
        group: 'contacts',
        data: { kind: 'contact' as const },
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
