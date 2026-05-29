import {
  rankTokens,
  scoreText,
  type SearchResult,
  type SearchSource,
} from '@tale/ui/search';
import { MessageSquare } from 'lucide-react';
import { useMemo } from 'react';

import { type Thread, useThreads } from '../hooks/queries';

interface ThreadsSearchSourceConfig {
  organizationId: string;
  teamId?: string;
  /** Fallback title for threads without one. */
  untitledLabel: string;
  /** Localised date-bucket label for a thread's creation time — used as the
   *  result group so the palette clusters chats by recency. */
  formatGroup: (creationTime: number) => string;
}

/**
 * Build a {@link SearchSource} over the user's chat threads. Threads are a
 * bounded, whole-collection query, so this ranks titles client-side with the
 * shared multi-token matcher (the controller debounces) and groups by a
 * localised date bucket. Mirrors
 * the docs factory pattern — returned from a `useMemo` so its identity stays
 * stable across renders.
 *
 * (Cross-page server-side thread search is a follow-up; swapping the client
 * filter for a backend `searchThreads` query is a one-line change here.)
 */
export function createThreadsSearchSource(
  config: ThreadsSearchSourceConfig,
): SearchSource {
  const { organizationId, teamId, untitledLabel, formatGroup } = config;
  return (query, { active }) => {
    const { threads } = useThreads({
      skip: !active,
      teamId,
      organizationId,
    });

    const results = useMemo<SearchResult[]>(() => {
      if (!threads) return [];
      // Multi-token, word-prefix-aware match + rank over titles, so "alpha
      // launch" finds "Launch plan: Alpha". A blank query keeps every thread
      // (score 1) in newest-first order.
      const tokens = rankTokens(query);
      return threads
        .map((thread: Thread) => ({
          thread,
          score: scoreText(thread.title ?? '', tokens),
        }))
        .filter((scored) => scored.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.thread._creationTime - a.thread._creationTime,
        )
        .map(
          ({ thread }): SearchResult => ({
            id: thread._id,
            title: thread.title ?? untitledLabel,
            group: formatGroup(thread._creationTime),
            icon: MessageSquare,
            data: thread,
          }),
        );
    }, [threads, query]);

    return {
      results,
      status: threads === undefined ? 'loading' : 'ready',
    };
  };
}
