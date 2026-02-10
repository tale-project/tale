import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useCreateCustomAgent() {
  return useMutation(api.custom_agents.mutations.createCustomAgent);
}

export function useUpdateCustomAgent() {
  return useMutation(api.custom_agents.mutations.updateCustomAgent);
}

export function useUpdateCustomAgentMetadata() {
  return useMutation(api.custom_agents.mutations.updateCustomAgentMetadata);
}

export function useDeleteCustomAgent() {
  return useMutation(api.custom_agents.mutations.deleteCustomAgent);
}

export function useDuplicateCustomAgent() {
  return useMutation(api.custom_agents.mutations.duplicateCustomAgent);
}

export function useRollbackCustomAgentVersion() {
  return useMutation(api.custom_agents.mutations.rollbackCustomAgentVersion);
}

export function usePublishCustomAgent() {
  return useMutation(api.custom_agents.mutations.publishCustomAgent);
}

export function useUnpublishCustomAgent() {
  return useMutation(api.custom_agents.mutations.unpublishCustomAgent);
}

export function useCreateCustomAgentWebhook() {
  return useMutation(api.custom_agents.webhooks.mutations.createWebhook);
}

export function useToggleCustomAgentWebhook() {
  return useMutation(api.custom_agents.webhooks.mutations.toggleWebhook);
}

export function useDeleteCustomAgentWebhook() {
  return useMutation(api.custom_agents.webhooks.mutations.deleteWebhook);
}
