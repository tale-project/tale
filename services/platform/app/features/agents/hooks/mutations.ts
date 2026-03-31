import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem writes)
// ---------------------------------------------------------------------------

export function useSaveAgent() {
  return useConvexAction(api.agents.file_actions.saveAgent);
}

export function useSnapshotToHistory() {
  return useConvexAction(api.agents.file_actions.snapshotToHistory);
}

export function useDuplicateAgent() {
  return useConvexAction(api.agents.file_actions.duplicateAgent);
}

export function useDeleteAgent() {
  return useConvexAction(api.agents.file_actions.deleteAgent);
}

export function useRestoreFromHistory() {
  return useConvexAction(api.agents.file_actions.restoreFromHistory);
}

// ---------------------------------------------------------------------------
// Mutation-based hooks (DB writes)
// ---------------------------------------------------------------------------

export function useUpdateAgentBindings() {
  return useConvexMutation(api.agents.mutations.updateAgentBindings);
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
