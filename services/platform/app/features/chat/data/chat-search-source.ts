'use client';

/**
 * The chat search source: the caller's conversations, matched by title or recent
 * message text through `"chat/search:searchChats"`. Used by the chat-scoped
 * palette and the global ⌘K palette.
 *
 * Shaped like the docs source (`createDocsSearchSource`): the factory is
 * memoised at the call site so the hook-shaped source keeps one identity —
 * the SearchCommand calls it every render and its inner hooks must run in a
 * stable order. Results opt out of the session cache: yesterday's hits
 * replaying under a new query would flash wrong rows.
 */

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useChatQuery } from './chat-backend';

const NO_RESULTS: SearchResult[] = [];

export function createChatSearchSource(options: {
  organizationId: string;
}): SearchSource {
  const { organizationId } = options;
  return (query, { active }) => {
    const { t } = useT('chat');
    const trimmed = query.trim();
    const hits = useChatQuery(
      'chat/search:searchChats',
      active && trimmed.length > 0
        ? { organizationId, query: trimmed }
        : 'skip',
      { cache: false },
    );

    const results = useMemo<SearchResult[]>(() => {
      if (hits.status !== 'ready') return NO_RESULTS;
      return hits.data.map((hit) => ({
        id: hit.threadId,
        title: hit.title ?? t('history.untitled'),
        subtitle: hit.snippet,
      }));
    }, [hits, t]);

    if (!active || trimmed.length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }
    return {
      results,
      // An unavailable backend reads as "no results" rather than an error
      // banner — the palette is a navigation aid, not a health surface.
      status: hits.status === 'loading' ? 'loading' : 'ready',
    };
  };
}
