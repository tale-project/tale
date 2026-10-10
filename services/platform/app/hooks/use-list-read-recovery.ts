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
 * notice and the table) before it re-reads. A refresh the reader did not
 * start takes a control away too, so `focusRegion` is also the notice's
 * `onFocusLost` (a refresh that heals the list takes the notice away) and
 * the table's `onErrorFocusLost` (a refresh of a list that never loaded
 * swaps the error state for the loading state): focus a reader had put on
 * either **Try again** lands on the list, not on the page.
 */
export function useListReadRecovery<
  T extends HTMLElement = HTMLDivElement,
>(read: {
  error: Error | null;
  results: readonly unknown[];
  retry: () => void;
}) {
  const regionRef = useRef<T>(null);
  const focusRegion = useCallback(() => {
    regionRef.current?.focus();
  }, []);
  const { retry } = read;
  const retryRead = useCallback(() => {
    focusRegion();
    retry();
  }, [focusRegion, retry]);
  return {
    regionRef,
    retryRead,
    focusRegion,
    failedWithRows: read.error !== null && read.results.length > 0,
  };
}
