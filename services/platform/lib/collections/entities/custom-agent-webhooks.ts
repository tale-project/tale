import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type CustomAgentWebhook = ConvexItemOf<
  typeof api.custom_agents.webhooks.queries.getWebhooks
>;

export const createCustomAgentWebhooksCollection: CollectionFactory<
  CustomAgentWebhook,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'custom-agent-webhooks',
    queryFn: api.custom_agents.webhooks.queries.getWebhooks,
    args: { customAgentId: toId<'customAgents'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          if ('isActive' in m.changes && m.changes.isActive !== undefined) {
            return convexClient.mutation(
              api.custom_agents.webhooks.mutations.toggleWebhook,
              {
                webhookId: toId<'customAgentWebhooks'>(m.key),
                isActive: m.changes.isActive,
              },
            );
          }
          return Promise.resolve();
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.custom_agents.webhooks.mutations.deleteWebhook,
            {
              webhookId: toId<'customAgentWebhooks'>(m.key),
            },
          ),
        ),
      );
    },
  });

export type { CustomAgentWebhook };
