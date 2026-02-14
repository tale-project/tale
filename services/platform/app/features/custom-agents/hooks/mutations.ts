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
  const { mutateAsync } = useConvexMutation(
    api.custom_agents.mutations.updateCustomAgent,
  );
  return mutateAsync;
}

export function useUpdateCustomAgentMetadata() {
  const { mutateAsync } = useConvexMutation(
    api.custom_agents.mutations.updateCustomAgentMetadata,
  );
  return mutateAsync;
}

export function useDeleteCustomAgent() {
  const { mutateAsync } = useConvexMutation(
    api.custom_agents.mutations.deleteCustomAgent,
  );
  return mutateAsync;
}

export function useToggleCustomAgentWebhook() {
  const { mutateAsync } = useConvexMutation(
    api.custom_agents.webhooks.mutations.toggleWebhook,
  );
  return mutateAsync;
}

export function useDeleteCustomAgentWebhook() {
  const { mutateAsync } = useConvexMutation(
    api.custom_agents.webhooks.mutations.deleteWebhook,
  );
  return mutateAsync;
}
