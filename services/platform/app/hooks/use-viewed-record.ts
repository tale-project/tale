'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PaginatedStatus } from './use-cached-paginated-query';

/**
 * The record a list page shows in its details dialog. Only the id is held;
 * the record itself is read from the live page on every render, so open
 * details follow later changes to their row. A record that leaves the settled
 * list — deleted, or moved out of the filter — is forgotten, so its details
 * never reopen on their own if it comes back.
 */
export function useViewedRecord<T extends { _id: string }>(
  results: readonly T[],
  status: PaginatedStatus,
) {
  const [viewingId, setViewingId] = useState<string | null>(null);

  const record = useMemo(
    () =>
      viewingId === null
        ? null
        : (results.find((candidate) => candidate._id === viewingId) ?? null),
    [viewingId, results],
  );

  const isGone =
    viewingId !== null && record === null && status !== 'LoadingFirstPage';

  useEffect(() => {
    if (isGone) setViewingId(null);
  }, [isGone]);

  const open = useCallback((id: string) => setViewingId(id), []);
  const close = useCallback(() => setViewingId(null), []);

  return { record, open, close };
}
