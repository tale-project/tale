import { queryOptions } from '@tanstack/react-query';

import { useReactQuery } from '@/app/hooks/use-react-query';
import { backendFetch } from '@/app/lib/backend/api-client';
import { backendKey } from '@/app/lib/backend/query-keys';
import { AGENT_CONNECTION_HINT_ENTITY } from '@/lib/shared/hint-entities';

import type {
  AgentConnectionAccess,
  AgentConnectionList,
  AgentConnectionsView,
} from '../types';

/**
 * The coding agents connected to an organization, as one view of them: the
 * person's own, or — for an owner or admin — everyone's, with or without the
 * ended ones. Shared by the page's hook and its route loader, so the loader
 * warms the very entry the table reads. Keyed under the `agent_connection`
 * hint entity, so a connection made, used or ended anywhere refreshes an open
 * list.
 */
export function agentConnectionsQuery(
  organizationId: string,
  view: AgentConnectionsView,
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      AGENT_CONNECTION_HINT_ENTITY,
      'list',
      view.scope,
      view.ended,
    ),
    queryFn: ({ signal }) =>
      backendFetch<AgentConnectionList>(
        `/agent-connections?${new URLSearchParams({
          scope: view.scope,
          ended: String(view.ended),
        })}`,
        { orgId: organizationId, signal },
      ),
  });
}

export function useAgentConnections(
  organizationId: string,
  view: AgentConnectionsView,
) {
  return useReactQuery(agentConnectionsQuery(organizationId, view));
}

/** What the signed-in person has to do with coding agents here. */
export function agentConnectionAccessQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      AGENT_CONNECTION_HINT_ENTITY,
      'access',
    ),
    queryFn: ({ signal }) =>
      backendFetch<AgentConnectionAccess>('/agent-connections/access', {
        orgId: organizationId,
        signal,
      }),
  });
}

/**
 * What opens the Connected agents page: that the deployment lets coding
 * agents sign in and the person may connect one here, or that they hold a
 * live connection.
 */
export function useAgentConnectionAccess(organizationId: string) {
  return useReactQuery(agentConnectionAccessQuery(organizationId));
}
