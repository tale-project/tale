import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type WfEventSubscription = ConvexItemOf<
  typeof api.workflows.triggers.queries.getEventSubscriptions
>;

export const createWfEventSubscriptionsCollection: CollectionFactory<
  WfEventSubscription,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'wf-event-subscriptions',
    queryFn: api.workflows.triggers.queries.getEventSubscriptions,
    args: { workflowRootId: toId<'wfDefinitions'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.workflows.triggers.mutations.createEventSubscription,
            {
              organizationId: m.modified.organizationId,
              workflowRootId: toId<'wfDefinitions'>(m.modified.workflowRootId),
              eventType: m.modified.eventType,
              eventFilter: m.modified.eventFilter,
            },
          ),
        ),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          if ('isActive' in m.changes && m.changes.isActive !== undefined) {
            await convexClient.mutation(
              api.workflows.triggers.mutations.toggleEventSubscription,
              {
                subscriptionId: toId<'wfEventSubscriptions'>(m.key),
                isActive: m.changes.isActive,
              },
            );
          }
          if ('eventFilter' in m.changes) {
            await convexClient.mutation(
              api.workflows.triggers.mutations.updateEventSubscription,
              {
                subscriptionId: toId<'wfEventSubscriptions'>(m.key),
                eventFilter: m.changes.eventFilter,
              },
            );
          }
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.workflows.triggers.mutations.deleteEventSubscription,
            {
              subscriptionId: toId<'wfEventSubscriptions'>(m.key),
            },
          ),
        ),
      );
    },
  });

export type { WfEventSubscription };
