'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { agentConnectionsQuery } from '@/app/features/settings/agent-connections/hooks/queries';

import {
  type ConnectionWatch,
  watchConnections,
} from '../lib/connection-watch';

/** How often to ask while nothing has connected: the list also refreshes the
 * moment Tale hears of a connection, and this covers a stream that is down. */
const POLL_MS = 5_000;

/**
 * Whether an agent signed in since the caller mounted. The connections that
 * existed when it mounted are the baseline, taken from the first answer that
 * arrived after it did, so a list cached from before cannot make an older
 * agent look new.
 */
export function useNewConnection(organizationId: string): ConnectionWatch {
  const mountedAt = useRef(Date.now());
  const before = useRef<ReadonlySet<string> | null>(null);

  const query = useQuery({
    ...agentConnectionsQuery(organizationId, { scope: 'mine', ended: false }),
    refetchInterval: (current) => {
      const data = current.state.data;
      if (
        before.current !== null &&
        data !== undefined &&
        watchConnections(before.current, data.connections).state === 'connected'
      ) {
        return false;
      }
      return POLL_MS;
    },
  });

  if (
    before.current === null &&
    query.data !== undefined &&
    query.dataUpdatedAt >= mountedAt.current
  ) {
    before.current = new Set(
      query.data.connections.map((connection) => connection.id),
    );
  }
  if (before.current === null || query.data === undefined) {
    return { state: 'waiting' };
  }
  return watchConnections(before.current, query.data.connections);
}
