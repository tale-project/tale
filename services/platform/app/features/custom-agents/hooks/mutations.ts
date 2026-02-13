import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { CustomAgentWebhook } from '@/lib/collections/entities/custom-agent-webhooks';
import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

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

export function useDeleteCustomAgent(
  collection: Collection<CustomAgent, string>,
) {
  return useCallback(
    async (args: { customAgentId: string }) => {
      const tx = collection.delete(args.customAgentId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useToggleCustomAgentWebhook(
  collection: Collection<CustomAgentWebhook, string>,
) {
  return useCallback(
    async (args: { webhookId: string; isActive: boolean }) => {
      const tx = collection.update(args.webhookId, (draft) => {
        draft.isActive = args.isActive;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteCustomAgentWebhook(
  collection: Collection<CustomAgentWebhook, string>,
) {
  return useCallback(
    async (args: { webhookId: string }) => {
      const tx = collection.delete(args.webhookId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
