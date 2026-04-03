import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { configKeys } from './config-query-keys';

/**
 * Connects to the /api/file-events SSE endpoint and invalidates TanStack
 * Query caches when config files change on disk (external edits, git pull,
 * other users, etc.).
 *
 * Mount once near the app root.
 */
export function useFileEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/events/file');

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
  }, [queryClient]);
}
