import { useCallback, useSyncExternalStore } from 'react';

import {
  NO_KEPT_RESULTS,
  type KeptTestResults,
} from '../lib/automation-tests/test-results';

/** How many automations' results the page keeps: the latest ones looked
 * at. A run's detail can be large, so the rest are let go. */
const KEPT_AUTOMATIONS_MAX = 10;

/** Each automation's results of this page's life, latest used last. */
const kept = new Map<string, KeptTestResults>();
const listeners = new Set<() => void>();

function keyOf(organizationId: string, automationSlug: string): string {
  return JSON.stringify([organizationId, automationSlug]);
}

function read(key: string): KeptTestResults {
  return kept.get(key) ?? NO_KEPT_RESULTS;
}

function write(key: string, results: KeptTestResults): void {
  kept.delete(key);
  kept.set(key, results);
  while (kept.size > KEPT_AUTOMATIONS_MAX) {
    const oldest = kept.keys().next();
    if (oldest.done === true) break;
    kept.delete(oldest.value);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The results of the tests run on this page, per automation and kept in
 * memory only: leaving the editor for the Runs tab and coming back finds
 * them still there; a reload, or ten other automations' results since,
 * lets them go. Each carries what it was judged against, so the panel can
 * tell a result that still holds from one the draft has moved past
 * (`../lib/automation-tests/test-results`).
 */
export function useKeptTestResults(
  organizationId: string,
  automationSlug: string,
): {
  results: KeptTestResults;
  update: (next: (previous: KeptTestResults) => KeptTestResults) => void;
} {
  const key = keyOf(organizationId, automationSlug);
  const results = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => NO_KEPT_RESULTS,
  );
  const update = useCallback(
    (next: (previous: KeptTestResults) => KeptTestResults) => {
      write(key, next(read(key)));
    },
    [key],
  );
  return { results, update };
}
