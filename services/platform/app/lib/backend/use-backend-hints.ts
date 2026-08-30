import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { eventsUrl } from './api-client';
import { reportBackendReachable } from './connection-state';
import { backendEntityPrefix } from './query-keys';

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
 * exactly the contract `backend/realtime/sse.ts` documents.
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
    source.addEventListener('hint', onHint);
    source.addEventListener('open', onOpen);
    return () => {
      source.removeEventListener('hint', onHint);
      source.removeEventListener('open', onOpen);
      source.close();
      // A closed stream is not an outage — the next mount reopens it.
      reportBackendReachable();
    };
  }, [orgId, queryClient]);
}
