import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useTestAgent() {
  return useConvexMutation(api.custom_agents.test_chat.testCustomAgent);
}

export function useCreateCustomAgent() {
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.createCustomAgent,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ name, displayName, description }, { insert }) =>
        insert({
          name,
          displayName,
          description,
          status: 'draft',
          _creationTime: Date.now(),
        }),
    },
  );
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
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.publishCustomAgent,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customAgentId }, { update }) =>
        update(customAgentId, { status: 'active' }),
    },
  );
}

export function useUnpublishCustomAgent() {
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.unpublishCustomAgent,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customAgentId }, { update }) =>
        update(customAgentId, { status: 'archived' }),
    },
  );
}

export function useCreateCustomAgentWebhook(customAgentId?: string) {
  return useConvexOptimisticMutation(
    api.custom_agents.webhooks.mutations.createWebhook,
    api.custom_agents.webhooks.queries.getWebhooks,
    {
      queryArgs: customAgentId ? { customAgentId } : undefined,
      onMutate: ({ organizationId }, { insert }) =>
        insert({
          organizationId,
          customAgentId: customAgentId ?? '',
          token: '',
          isActive: true,
          createdAt: Date.now(),
        }),
    },
  );
}

export function useUpdateCustomAgent() {
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.updateCustomAgent,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customAgentId, ...changes }, { update }) =>
        update(customAgentId, changes),
    },
  );
}

export function useUpdateCustomAgentMetadata() {
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.updateCustomAgentMetadata,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customAgentId, ...changes }, { update }) =>
        update(customAgentId, changes),
    },
  );
}

export function useDeleteCustomAgent() {
  return useConvexOptimisticMutation(
    api.custom_agents.mutations.deleteCustomAgent,
    api.custom_agents.queries.listCustomAgents,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ customAgentId }, { remove }) => remove(customAgentId),
    },
  );
}

export function useToggleCustomAgentWebhook(customAgentId?: string) {
  return useConvexOptimisticMutation(
    api.custom_agents.webhooks.mutations.toggleWebhook,
    api.custom_agents.webhooks.queries.getWebhooks,
    {
      queryArgs: customAgentId ? { customAgentId } : undefined,
      onMutate: ({ webhookId }, { toggle }) => toggle(webhookId, 'isActive'),
    },
  );
}

export function useDeleteCustomAgentWebhook(customAgentId?: string) {
  return useConvexOptimisticMutation(
    api.custom_agents.webhooks.mutations.deleteWebhook,
    api.custom_agents.webhooks.queries.getWebhooks,
    {
      queryArgs: customAgentId ? { customAgentId } : undefined,
      onMutate: ({ webhookId }, { remove }) => remove(webhookId),
    },
  );
}
