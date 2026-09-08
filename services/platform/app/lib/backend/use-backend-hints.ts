import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { eventsUrl } from './api-client';
import { reportBackendReachable } from './connection-state';
import { backendEntityPrefix, backendOrgPrefix } from './query-keys';

/**
 * `EventSource.CLOSED` as a literal: the browser has given up on this source
 * and will not reconnect. Read from the instance rather than the constructor
 * so a stubbed global cannot change the meaning of the check.
 */
const EVENT_SOURCE_CLOSED = 2;
/** First delay before we reopen a stream the browser abandoned. */
const RECONNECT_BASE_MS = 1_000;
/** Ceiling for the backoff — a backend that stays down is polled once a minute. */
const RECONNECT_MAX_MS = 60_000;

/**
 * The Tier-2 realtime bridge: subscribe the org's `/events` hint stream and
 * invalidate the matching `['backend', orgId, entity]` queries — hints
 * carry identity, never data, so every refetch goes back through the
 * authenticated route the query already uses.
 *
 * One `EventSource` per mounted org scope. A stream that OPENED and then
 * dropped is the browser's problem: it reconnects natively, replaying from
 * `Last-Event-ID`, and the server heartbeats every 15s so proxies keep the
 * lane open. A HANDSHAKE that answered non-200 is ours — per the HTML
 * spec the browser sets `readyState` to `CLOSED` and never retries, so a
 * rolling deploy's 502 (or a transient 401) would otherwise leave the tab
 * silently frozen: every mutation from any other session stops arriving and
 * nothing on screen says so, until the user reloads by hand. We reopen those
 * ourselves with a capped backoff.
 *
 * A reopened source carries no `Last-Event-ID`, so hints emitted while it was
 * down are gone for good — the whole org scope refetches on the first open
 * after a forced reconnect, the same contract `resync` has when the server
 * cannot replay a cursor. `forbidden` stays terminal: the server re-proves
 * membership and the session while the stream is open and ends it once
 * either is gone, so reopening would only meet a guaranteed 401/403.
 */
export function useBackendHints(orgId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    // Bound to a const so the narrowing survives into the closures below —
    // a parameter's narrowing does not.
    const org = orgId;
    if (org === undefined || org === '') {
      return undefined;
    }
    let source: EventSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    /** Set once the effect is torn down, or `forbidden` ended the stream. */
    let stopped = false;
    /** A forced reconnect skipped the cursor: refetch on the next open. */
    let replayLost = false;

    const onHint = (event: MessageEvent<string>): void => {
      try {
        const hint: unknown = JSON.parse(event.data);
        if (
          hint !== null &&
          typeof hint === 'object' &&
          'entity' in hint &&
          typeof hint.entity === 'string'
        ) {
          void queryClient.invalidateQueries({
            queryKey: backendEntityPrefix(org, hint.entity),
          });
        }
      } catch (error) {
        console.warn('[backend-hints] unparseable hint event:', error);
      }
    };
    // `open` is positive evidence the backend answered, and the point where a
    // gap in the hint stream has to be paid for with a refetch.
    const onOpen = (): void => {
      attempt = 0;
      reportBackendReachable();
      if (replayLost) {
        replayLost = false;
        void queryClient.invalidateQueries({
          queryKey: backendOrgPrefix(org),
        });
      }
    };
    // The replay had a hole: hints between the reconnect cursor and now were
    // reclaimed, so nothing the cache holds for this org can be trusted.
    const onResync = (): void => {
      void queryClient.invalidateQueries({ queryKey: backendOrgPrefix(org) });
    };
    // The reader lost the org (or the session): stop for good. The next mount
    // — a fresh sign-in, a re-added member — reopens it.
    const onForbidden = (): void => {
      stopped = true;
      detach();
    };
    // Only a source the browser has ABANDONED is ours to reopen; one that is
    // CONNECTING is already retrying natively and must be left alone, or the
    // two loops race and open a stream per error.
    const onError = (): void => {
      if (stopped || source?.readyState !== EVENT_SOURCE_CLOSED) {
        return;
      }
      detach();
      replayLost = true;
      const delay = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_BASE_MS * 2 ** attempt,
      );
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    // Arrow consts, not declarations: a hoisted `function` is callable before
    // the narrowing above, so TypeScript widens `org` back to `undefined`.
    const detach = (): void => {
      if (source === undefined) {
        return;
      }
      source.removeEventListener('hint', onHint);
      source.removeEventListener('resync', onResync);
      source.removeEventListener('open', onOpen);
      source.removeEventListener('forbidden', onForbidden);
      source.removeEventListener('error', onError);
      source.close();
      source = undefined;
    };

    const connect = (): void => {
      retryTimer = undefined;
      if (stopped) {
        return;
      }
      source = new EventSource(eventsUrl(org), {
        withCredentials: true,
      });
      source.addEventListener('hint', onHint);
      source.addEventListener('resync', onResync);
      source.addEventListener('open', onOpen);
      source.addEventListener('forbidden', onForbidden);
      source.addEventListener('error', onError);
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      detach();
      // A closed stream is not an outage — the next mount reopens it.
      reportBackendReachable();
    };
  }, [orgId, queryClient]);
}
