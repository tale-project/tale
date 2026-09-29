'use client';

import { useCallback, useRef } from 'react';

/**
 * The host half of a paginated collection screen's read recovery (#3777).
 * The table shows a failed first page itself (`useListPage`'s `error`, with
 * this `retry`); rows a later read left on screen stay, and the host names
 * that failure above them (`failedWithRows`) with the same retry.
 *
 * Either retry replaces the control that ran it — with the table's loading
 * state, or with the rows once they are back — so it moves focus onto the
 * list region (`regionRef`, a focusable named `role="region"` around the
 * notice and the table) before it re-reads.
 */
export function useListReadRecovery(read: {
  error: Error | null;
  results: readonly unknown[];
  retry: () => void;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const { retry } = read;
  const retryRead = useCallback(() => {
    regionRef.current?.focus();
    retry();
  }, [retry]);
  return {
    regionRef,
    retryRead,
    failedWithRows: read.error !== null && read.results.length > 0,
  };
}
