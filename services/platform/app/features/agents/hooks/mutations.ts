import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return (organizationId: string) => {
    void queryClient.invalidateQueries({
      queryKey: ['config', 'agents', organizationId],
    });
    // Skill bindings live on the agent JSON, so any agent-config write
    // can change which skills are attached to a thread's agent. Refresh
    // every skill-scoped cache entry that depends on agent state — the
    // chat-header chip query and `useFindAgentsBindingSkill` are both
    // keyed under this prefix.
    void queryClient.invalidateQueries({
      queryKey: ['config', 'skills', organizationId],
    });
  };
}

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem writes)
// ---------------------------------------------------------------------------

export function useSaveAgent() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.file_actions.saveAgent, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useSnapshotToHistory() {
  return useConvexAction(api.agents.file_actions.snapshotToHistory);
}

export function useDuplicateAgent() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.file_actions.duplicateAgent, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDeleteAgent() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.file_actions.deleteAgent, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useRestoreFromHistory() {
  const invalidate = useInvalidateAgents();
  return useConvexAction(api.agents.file_actions.restoreFromHistory, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useTranslateAgentFields() {
  return useConvexAction(api.agents.file_actions.translateAgentFields);
}

// ---------------------------------------------------------------------------
// Mutation-based hooks (DB writes)
// ---------------------------------------------------------------------------

export function useUpdateAgentBindings() {
  const invalidate = useInvalidateAgents();
  return useConvexMutation(api.agents.mutations.updateAgentBindings, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useUpdateAgentSharing() {
  return useConvexMutation(api.agents.mutations.updateAgentSharing);
}

export function useAddKnowledgeFile() {
  return useConvexMutation(api.agents.mutations.addKnowledgeFile);
}

export function useRemoveKnowledgeFile() {
  return useConvexMutation(api.agents.mutations.removeKnowledgeFile);
}

// ---------------------------------------------------------------------------
// Webhook hooks
// ---------------------------------------------------------------------------

export function useCreateAgentWebhook() {
  return useConvexMutation(api.agents.webhooks.mutations.createWebhook);
}

export function useToggleAgentWebhook() {
  return useConvexMutation(api.agents.webhooks.mutations.toggleWebhook);
}

export function useDeleteAgentWebhook() {
  return useConvexMutation(api.agents.webhooks.mutations.deleteWebhook);
}
