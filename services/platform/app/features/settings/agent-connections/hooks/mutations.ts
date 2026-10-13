import { useReactMutation } from '@/app/hooks/use-react-mutation';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { backendFetch } from '@/app/lib/backend/api-client';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { AGENT_CONNECTION_HINT_ENTITY } from '@/lib/shared/hint-entities';

import type { AgentConnection } from '../types';

/**
 * Disconnect a coding agent: the person's own, or — for an owner or admin —
 * anyone's here. The agent is refused at once. Every view of the
 * organization's connections is refetched, and so is what the person has to
 * do with agents (their last connection may have gone).
 */
export function useDisconnectAgent(organizationId: string) {
  const queryClient = useReactQueryClient();

  return useReactMutation({
    mutationFn: (connection: Pick<AgentConnection, 'id'>) =>
      backendFetch<{ ok: true; id: string }>(
        `/agent-connections/${encodeURIComponent(connection.id)}`,
        { orgId: organizationId, method: 'DELETE' },
      ),
    // Returned, so the dialog closes once the list no longer holds the row.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: backendEntityPrefix(
          organizationId,
          AGENT_CONNECTION_HINT_ENTITY,
        ),
      }),
  });
}
