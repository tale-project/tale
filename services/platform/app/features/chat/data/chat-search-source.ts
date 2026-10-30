'use client';

/**
 * The chat search source: the caller's conversations, matched by title or recent
 * message text through `"chat/search:searchChats"`. Used by the shared shell
 * palette (Chats scope and the chats group under Everything).
 *
 * Shaped like the docs source (`createDocsSearchSource`): the factory is
 * memoised at the call site so the hook-shaped source keeps one identity —
 * the SearchCommand calls it every render and its inner hooks must run in a
 * stable order. Results opt out of the session cache: yesterday's hits
 * replaying under a new query would flash wrong rows.
 */

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { stripMarkdown } from '@tale/ui/search/strip-markdown';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useChatQuery, useChatSearchRetry } from './chat-backend';

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
    const retrySearch = useChatSearchRetry(organizationId);
    // Asked again, a search that never answered starts over as `loading`,
    // or shows another query's last answer while it runs, so its failure
    // is held here until that retry settles: the palette keeps its busy
    // Try again instead of a skeleton or rows this query never found.
    const [retryingQuery, setRetryingQuery] = useState<string | null>(null);

    const results = useMemo<SearchResult[]>(() => {
      if (hits.status !== 'ready') return NO_RESULTS;
      return hits.data.map((hit) => ({
        id: hit.threadId,
        title: hit.title ?? t('history.untitled'),
        // The matching message as the prose its reader saw, not its
        // markdown source; as a `body` the row cuts the excerpt around the
        // match and highlights it, the way a docs hit reads.
        body: stripMarkdown(hit.snippet),
      }));
    }, [hits, t]);

    if (!active || trimmed.length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }
    const retrying = retryingQuery === trimmed;
    // A failed search is the palette's to name and retry, never "no
    // results" (#4890): a chat that exists must not read as missing.
    if (retrying || hits.status === 'unavailable') {
      return {
        results: NO_RESULTS,
        status: 'error',
        retrying,
        retry: () => {
          setRetryingQuery(trimmed);
          void retrySearch(trimmed).finally(() => {
            setRetryingQuery((current) =>
              current === trimmed ? null : current,
            );
          });
        },
      };
    }
    return {
      results,
      status: hits.status === 'loading' ? 'loading' : 'ready',
    };
  };
}
