import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useTestAgent() {
  return useConvexMutation(api.custom_agents.test_chat.testCustomAgent);
}

export function useCreateCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.createCustomAgent);
}

export function useDuplicateCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.duplicateCustomAgent);
}

export function useActivateCustomAgentVersion() {
  return useConvexMutation(
    api.custom_agents.mutations.activateCustomAgentVersion,
  );
}

export function useCreateDraftFromVersion() {
  return useConvexMutation(api.custom_agents.mutations.createDraftFromVersion);
}

export function usePublishCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.publishCustomAgent);
}

export function useUnpublishCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.unpublishCustomAgent);
}

export function useCreateCustomAgentWebhook() {
  return useConvexMutation(api.custom_agents.webhooks.mutations.createWebhook);
}

export function useUpdateCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.updateCustomAgent);
}

export function useUpdateCustomAgentMetadata() {
  return useConvexMutation(
    api.custom_agents.mutations.updateCustomAgentMetadata,
  );
}

export function useUpdateCustomAgentVisibility() {
  return useConvexMutation(
    api.custom_agents.mutations.updateCustomAgentVisibility,
  );
}

export function useDeleteCustomAgent() {
  return useConvexMutation(api.custom_agents.mutations.deleteCustomAgent);
}

export function useToggleCustomAgentWebhook() {
  return useConvexMutation(api.custom_agents.webhooks.mutations.toggleWebhook);
}

export function useDeleteCustomAgentWebhook() {
  return useConvexMutation(api.custom_agents.webhooks.mutations.deleteWebhook);
}
