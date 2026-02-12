import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { CustomAgentWebhook } from '@/lib/collections/entities/custom-agent-webhooks';
import type { CustomAgent } from '@/lib/collections/entities/custom-agents';

export function useUpdateCustomAgent(
  collection: Collection<CustomAgent, string>,
) {
  return useCallback(
    async (args: { customAgentId: string } & Record<string, unknown>) => {
      const { customAgentId, ...fields } = args;
      const tx = collection.update(customAgentId, (draft) => {
        Object.assign(draft, fields);
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateCustomAgentMetadata(
  collection: Collection<CustomAgent, string>,
) {
  return useCallback(
    async (args: {
      customAgentId: string;
      name?: string;
      displayName?: string;
      description?: string;
      avatarUrl?: string;
      teamId?: string;
      sharedWithTeamIds?: string[];
    }) => {
      const { customAgentId, ...fields } = args;
      const tx = collection.update(customAgentId, (draft) => {
        Object.assign(draft, fields);
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
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
