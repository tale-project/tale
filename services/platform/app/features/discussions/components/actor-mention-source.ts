import { type SearchResult, type SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import type { ActorMentionData } from '../../chat/components/actor-mention-popover';
import {
  filterMentionActorOptions,
  useMentionActorOptions,
} from '../../tasks/lib/mention-actor-options';

interface ActorMentionSourceConfig {
  organizationId: string;
  projectId: Id<'projects'>;
}

/**
 * Build a {@link SearchSource} over a project's mentionable actors (org members
 * + project agents) for the discussion composer's `@`-mention picker. Backed by
 * the shared, server-aligned {@link useMentionActorOptions} (already loaded by
 * the discussion view's directory, so no extra query); filtering is client-side.
 *
 * Returned from the caller's `useMemo` so its identity stays stable across
 * renders (the SearchSource contract — it is called as a hook by ChatInput).
 */
export function createActorMentionSource(
  config: ActorMentionSourceConfig,
): SearchSource<ActorMentionData> {
  const { organizationId, projectId } = config;
  return (query, { active }) => {
    const options = useMentionActorOptions(organizationId, projectId);
    const results = useMemo<SearchResult<ActorMentionData>[]>(() => {
      if (!active) return [];
      return filterMentionActorOptions(options, query).map((o) => ({
        id: `${o.type}:${o.id}`,
        title: o.name,
        subtitle: `@${o.handle}`,
        data: { type: o.type, id: o.id, name: o.name, handle: o.handle },
      }));
    }, [active, options, query]);

    return { results, status: active ? 'ready' : 'idle' };
  };
}
