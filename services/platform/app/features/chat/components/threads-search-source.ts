import type { SearchResult, SearchSource } from '@tale/ui/search';
import { MessageSquare } from 'lucide-react';
import { useMemo } from 'react';

import { filterByTextSearch } from '@/lib/utils/filtering';

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
 * bounded, whole-collection query, so this filters titles client-side (the
 * shared controller debounces) and groups by a localised date bucket. Mirrors
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
      const matched = query
        ? filterByTextSearch(threads, query, ['title'])
        : threads;
      return matched.map(
        (thread: Thread): SearchResult => ({
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
