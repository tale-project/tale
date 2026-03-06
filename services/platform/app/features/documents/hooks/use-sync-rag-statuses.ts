import { useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useSyncRagStatuses(
  organizationId: string,
  documentIds: Id<'documents'>[],
) {
  const { mutate: syncRagStatuses } = useConvexAction(
    api.documents.actions.syncRagStatuses,
  );

  const syncRef = useRef(syncRagStatuses);
  syncRef.current = syncRagStatuses;

  useEffect(() => {
    if (documentIds.length === 0) return;

    const key = `rag-sync-${organizationId}`;
    const lastSync = sessionStorage.getItem(key);
    if (lastSync && Date.now() - Number(lastSync) < SYNC_INTERVAL_MS) return;

    sessionStorage.setItem(key, String(Date.now()));
    syncRef.current(
      { documentIds },
      {
        onError: (error) => {
          console.warn('[useSyncRagStatuses] Sync failed:', error);
          sessionStorage.removeItem(key);
        },
      },
    );
  }, [organizationId, documentIds]);
}
