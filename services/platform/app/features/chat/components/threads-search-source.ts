import { type SearchResult, type SearchSource } from '@tale/ui/search';
import { MessageSquare } from 'lucide-react';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

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

// Below this length we don't run the (heavier) message-content search — a
// 1-char query just narrows the recents list by title.
const MIN_MESSAGE_QUERY = 2;

/**
 * Build a {@link SearchSource} over the user's chats. A real query (≥2 chars)
 * runs a backend search over message **content** and surfaces the chat title
 * with the matched message as the snippet; a blank/1-char query falls back to
 * the recent chats filtered by title (so opening the palette shows recents).
 *
 * Returned from a `useMemo` so its identity stays stable across renders.
 */
export function createThreadsSearchSource(
  config: ThreadsSearchSourceConfig,
): SearchSource {
  const { organizationId, teamId, untitledLabel, formatGroup } = config;
  return (query, { active }) => {
    const trimmed = query.trim();
    const searchingMessages = active && trimmed.length >= MIN_MESSAGE_QUERY;

    // Recents (titles) — skipped once we're doing a message search so the two
    // queries never run at once. Both hooks are still called every render.
    const { threads } = useThreads({
      skip: !active || searchingMessages,
      teamId,
      organizationId,
    });

    // Message-content search — skipped until the query is long enough.
    const { data: matches } = useConvexQuery(
      api.threads.search_messages.searchThreadMessages,
      searchingMessages ? { organizationId, query: trimmed, teamId } : 'skip',
    );

    const results = useMemo<SearchResult[]>(() => {
      if (searchingMessages) {
        return (matches ?? []).map(
          (m): SearchResult => ({
            id: m.threadId,
            title: m.title ?? untitledLabel,
            // `body` drives the highlighted snippet (the matched message).
            body: m.snippet || undefined,
            group: formatGroup(m.createdAt),
            icon: MessageSquare,
          }),
        );
      }
      const q = trimmed.toLowerCase();
      return (threads ?? [])
        .filter(
          (thread: Thread) =>
            !q || (thread.title ?? '').toLowerCase().includes(q),
        )
        .map(
          (thread: Thread): SearchResult => ({
            id: thread._id,
            title: thread.title ?? untitledLabel,
            group: formatGroup(thread._creationTime),
            icon: MessageSquare,
            data: thread,
          }),
        );
      // `untitledLabel` / `formatGroup` come from the source factory's config
      // closure (stable for the source's lifetime), so they're intentionally
      // omitted from the reactive deps.
    }, [searchingMessages, matches, threads, trimmed]);

    const status = !active
      ? 'idle'
      : searchingMessages
        ? matches === undefined
          ? 'loading'
          : 'ready'
        : threads === undefined
          ? 'loading'
          : 'ready';

    return { results, status };
  };
}
