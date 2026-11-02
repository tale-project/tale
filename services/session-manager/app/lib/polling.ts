import type { QueryClient } from '@tanstack/react-query';

import type { Meta, Session } from '@/lib/api/schemas';

import type { ListResult } from './api/client';
import { queryKeys } from './api/keys';

/** While a proxy is being checked or a session is busy. */
export const POLL_FAST_MS = 1500;
export const POLL_SLOW_MS = 5000;
/** The longest wait between two tries while the server does not answer. */
export const POLL_MAX_MS = 30_000;

/**
 * How long to wait before asking again after `failures` failed tries in a row
 * (at least one): 5, 10, 20, then 30 seconds. A server that is restarting is
 * found again quickly, and one that is gone is not asked every few seconds.
 */
export function offlineDelay(failures: number): number {
  return Math.min(POLL_SLOW_MS * 2 ** (failures - 1), POLL_MAX_MS);
}

/** A session whose browser is on its way up or down, or being given a proxy. */
export function sessionIsBusy(session: Session): boolean {
  return (
    session.activity !== null ||
    session.status === 'starting' ||
    session.status === 'stopping'
  );
}

function isSessionList(data: unknown): data is ListResult<Session> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    Array.isArray(data.items)
  );
}

function isSession(data: unknown): data is Session {
  return (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    'activity' in data
  );
}

function isMeta(data: unknown): data is Meta {
  return typeof data === 'object' && data !== null && 'counts' in data;
}

/** Whether anything on screen is still changing by itself. */
export function somethingIsBusy(queryClient: QueryClient): boolean {
  const meta = queryClient.getQueryData(queryKeys.meta);
  // A browser that is missing is not busy: only a download under way changes
  // by itself. One that failed, or that nobody started, would keep the page at
  // the quick pace for ever; the banner tells it, and an install made by hand
  // is noticed at the slow one.
  if (
    isMeta(meta) &&
    (meta.counts.checkingProxies > 0 || meta.browserInstalling)
  ) {
    return true;
  }
  // The windows of the list and the single sessions of a page alike.
  return queryClient
    .getQueriesData({ queryKey: queryKeys.sessions })
    .some(([, data]) =>
      isSessionList(data)
        ? data.items.some(sessionIsBusy)
        : isSession(data) && sessionIsBusy(data),
    );
}

/** What the polling reads of a query: how it stands, and how many tries failed so far. */
interface PolledQuery {
  state: { status: string; errorUpdateCount: number };
}

/**
 * How many of a query's failures stood at its last answer. The query counts
 * every failure it ever had; the ones in a row are those since. (The count of
 * its own tries that failed starts again with every try, so it cannot say.)
 */
const failuresAtLastAnswer = new WeakMap<object, number>();

/** The tries in a row that failed: none once the query has answered. */
function failuresInARow(query: PolledQuery): number {
  const { status, errorUpdateCount } = query.state;
  // A query the cache reset starts counting from nothing again.
  let before = failuresAtLastAnswer.get(query) ?? 0;
  if (before > errorUpdateCount) before = 0;
  if (status === 'success') before = errorUpdateCount;
  failuresAtLastAnswer.set(query, before);
  return errorUpdateCount - before;
}

/**
 * The `refetchInterval` of every polled read: quick while something changes,
 * slow otherwise, and ever slower while the server does not answer (see
 * `offlineDelay`), until its first answer puts the pace right again.
 */
export function pollInterval(queryClient: QueryClient) {
  return (query: PolledQuery): number => {
    const failures = failuresInARow(query);
    if (failures > 0) return offlineDelay(failures);
    return somethingIsBusy(queryClient) ? POLL_FAST_MS : POLL_SLOW_MS;
  };
}
