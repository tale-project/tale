import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { projectCapabilityCatalogKey } from '@/app/lib/backend/query-keys';
import { HINT_BATCH_MS } from '@/app/lib/backend/use-backend-hints';
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

  // The wire payload carries `orgSlug` (the on-disk path segment), but the
  // query cache is keyed by `organizationId` after the org-identity
  // unification. Hold a slug→id map in a ref so the SSE listener can
  // translate without re-subscribing each time memberships refresh.
  const { organizations } = useUserOrganizationsWithDetails();
  const slugToIdRef = useRef(new Map<string, string>());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const o of organizations ?? []) {
      if (o.slug) next.set(o.slug, o.organizationId);
    }
    slugToIdRef.current = next;
  }, [organizations]);

  useEffect(() => {
    if (!enabled) return undefined;

    const es = new EventSource('/events/file');
    // Distinct skill slugs arrive as separate events during imports/git pulls.
    // Refresh each org's catalogs once per window, as the hint stream does.
    const pendingOrgIds = new Set<string>();
    let catalogTimer: ReturnType<typeof setTimeout> | undefined;
    const flushCatalogs = (): void => {
      catalogTimer = undefined;
      const orgIds = [...pendingOrgIds];
      pendingOrgIds.clear();
      for (const id of orgIds) {
        void queryClient.invalidateQueries({
          queryKey: projectCapabilityCatalogKey(id),
        });
      }
    };

    es.addEventListener('error', () => {
      es.close();
    });

    es.addEventListener('message', (e) => {
      let data: { type: string; orgSlug?: string };
      try {
        data = JSON.parse(e.data);
      } catch (err) {
        console.warn('[useFileEvents] Failed to parse SSE message:', err);
        return;
      }

      // Skip the initial "connected" event
      if (data.type === 'connected') return;

      // Project equipment reads the same files as the config catalog.
      if (data.type === 'skills' || data.type === 'connectors') {
        const orgId = data.orgSlug
          ? slugToIdRef.current.get(data.orgSlug)
          : undefined;
        const orgIds = data.orgSlug
          ? orgId
            ? [orgId]
            : []
          : [...slugToIdRef.current.values()];
        for (const id of orgIds) pendingOrgIds.add(id);
        if (pendingOrgIds.size > 0) {
          catalogTimer ??= setTimeout(flushCatalogs, HINT_BATCH_MS);
        }
      }

      // Events without an orgSlug (e.g. global branding) invalidate the
      // whole config-type prefix.
      if (!data.orgSlug) {
        void queryClient.invalidateQueries({
          queryKey: configKeys.type(data.type),
        });
        return;
      }

      // Translate slug→id. If the slug doesn't match any org the current
      // user is a member of, the event is for an org they can't see —
      // skip silently rather than firing a no-op invalidation.
      const organizationId = slugToIdRef.current.get(data.orgSlug);
      if (!organizationId) return;

      void queryClient.invalidateQueries({
        queryKey: ['config', data.type, organizationId],
      });
    });

    return () => {
      es.close();
      if (catalogTimer !== undefined) clearTimeout(catalogTimer);
      pendingOrgIds.clear();
    };
  }, [queryClient, enabled]);
}
