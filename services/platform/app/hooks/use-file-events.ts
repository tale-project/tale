import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getEnv } from '@/lib/env';

import { configKeys } from './config-query-keys';

/**
 * Connects to the /events/file SSE endpoint and invalidates TanStack Query
 * caches when config files change on disk (external edits, git pull, other
 * users, etc.).
 *
 * Requires `TALE_FILE_EVENTS=true` on the server. When the feature is
 * disabled the hook is a no-op — no EventSource is created.
 *
 * Mount once near the app root.
 */
export function useFileEvents() {
  const queryClient = useQueryClient();

  const enabled = getEnv('FILE_EVENTS_ENABLED');

  useEffect(() => {
    if (!enabled) return undefined;

    const es = new EventSource('/events/file');

    es.addEventListener('error', () => {
      es.close();
    });

    es.addEventListener('message', (e) => {
      let data: { type: string; orgSlug?: string };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }

      // Skip the initial "connected" event
      if (data.type === 'connected') return;

      // Invalidate all queries for this config type (+ org if present)
      const prefix = data.orgSlug
        ? ['config', data.type, data.orgSlug]
        : configKeys.type(data.type);

      void queryClient.invalidateQueries({ queryKey: prefix });
    });

    return () => es.close();
  }, [queryClient, enabled]);
}
