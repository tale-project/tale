import { useQueryClient } from '@tanstack/react-query';

import { configKeys } from '@/app/hooks/config-query-keys';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: configKeys.type('agents') });
}

/**
 * Upsert an agent keyed by slug. Omitted optional fields mean "leave as-is"
 * (the server merges over the on-disk file); `tools`/`skills` additionally
 * accept `null` to REMOVE a narrowing — absent keeps, `[]` narrows to
 * nothing, `null` widens back to "everything".
 */
export function useSaveAgent() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.actions.saveAgent, {
    onSuccess: () => invalidate(),
  });
}

/** Delete an agent and its history (owner or org-admin; enforced server-side). */
export function useDeleteAgent() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.actions.deleteAgent, {
    onSuccess: () => invalidate(),
  });
}

/** Restore a history snapshot as the current version (additive). */
export function useRestoreAgentFromHistory() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.actions.restoreAgentFromHistory, {
    onSuccess: () => invalidate(),
  });
}
