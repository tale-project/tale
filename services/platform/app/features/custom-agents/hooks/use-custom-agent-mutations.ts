import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCreateCustomAgent() {
  return useMutation(api.custom_agents.mutations.createCustomAgent);
}

export function useUpdateCustomAgent() {
  return useMutation(api.custom_agents.mutations.updateCustomAgent);
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
