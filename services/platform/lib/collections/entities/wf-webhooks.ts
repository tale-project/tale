import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type WfWebhook = ConvexItemOf<
  typeof api.workflows.triggers.queries.getWebhooks
>;

export const createWfWebhooksCollection: CollectionFactory<
  WfWebhook,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'wf-webhooks',
    queryFn: api.workflows.triggers.queries.getWebhooks,
    args: { workflowRootId: toId<'wfDefinitions'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.workflows.triggers.mutations.createWebhook,
            {
              organizationId: m.modified.organizationId,
              workflowRootId: toId<'wfDefinitions'>(m.modified.workflowRootId),
            },
          ),
        ),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          if ('isActive' in m.changes && m.changes.isActive !== undefined) {
            return convexClient.mutation(
              api.workflows.triggers.mutations.toggleWebhook,
              {
                webhookId: toId<'wfWebhooks'>(m.key),
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
            api.workflows.triggers.mutations.deleteWebhook,
            {
              webhookId: toId<'wfWebhooks'>(m.key),
            },
          ),
        ),
      );
    },
  });

export type { WfWebhook };
