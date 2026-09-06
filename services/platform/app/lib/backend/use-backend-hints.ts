import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { eventsUrl } from './api-client';
import { reportBackendReachable } from './connection-state';
import { backendEntityPrefix, backendOrgPrefix } from './query-keys';

/**
 * The Tier-2 realtime bridge: subscribe the org's `/events` hint stream and
 * invalidate the matching `['backend', orgId, entity]` queries — hints
 * carry identity, never data, so every refetch goes back through the
 * authenticated route the query already uses.
 *
 * One `EventSource` per mounted org scope. Reconnects (with `Last-Event-ID`
 * replay) are the browser's native behavior; the server heartbeats every
 * 15s so proxies keep the lane open. On `error` the source retries on its
 * own — TanStack's refetch-on-reconnect covers anything missed while down,
 * exactly the contract `backend/realtime/sse.ts` documents. When the server
 * cannot replay a resume in full (the cursor is older than the outbox's
 * retention) it sends `resync` first, and the whole org scope refetches.
 * `forbidden` is terminal: the server re-proves membership and the session
 * while the stream is open and ends it once either is gone — the source is
 * closed here instead of reconnecting into a guaranteed 401/403.
 */
export function useBackendHints(orgId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (orgId === undefined || orgId === '') {
      return undefined;
    }
    const source = new EventSource(eventsUrl(orgId), {
      withCredentials: true,
    });
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
            queryKey: backendEntityPrefix(orgId, hint.entity),
          });
        }
      } catch (error) {
        console.warn('[backend-hints] unparseable hint event:', error);
      }
    };
    // `open` is positive evidence the backend answered. `error` is not the
    // inverse: EventSource emits it on every reconnect and when a proxy
    // (Vite preview in E2E, Caddy idle timeout) drops the lane — the
    // browser retries on its own. The offline overlay reasons on HTTP
    // `fetch` failures in `backendFetch`, not on this stream.
    const onOpen = (): void => {
      reportBackendReachable();
    };
    // The replay had a hole: hints between the reconnect cursor and now were
    // reclaimed, so nothing the cache holds for this org can be trusted.
    const onResync = (): void => {
      void queryClient.invalidateQueries({
        queryKey: backendOrgPrefix(orgId),
      });
    };
    // The reader lost the org (or the session): stop, do not auto-reconnect.
    // The next mount — a fresh sign-in, a re-added member — reopens it.
    const onForbidden = (): void => {
      source.close();
    };
    source.addEventListener('hint', onHint);
    source.addEventListener('resync', onResync);
    source.addEventListener('open', onOpen);
    source.addEventListener('forbidden', onForbidden);
    return () => {
      source.removeEventListener('hint', onHint);
      source.removeEventListener('resync', onResync);
      source.removeEventListener('open', onOpen);
      source.removeEventListener('forbidden', onForbidden);
      source.close();
      // A closed stream is not an outage — the next mount reopens it.
      reportBackendReachable();
    };
  }, [orgId, queryClient]);
}
