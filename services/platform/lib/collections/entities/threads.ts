import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Thread = ConvexItemOf<typeof api.threads.queries.listThreads>;

export const createThreadsCollection: CollectionFactory<Thread, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'threads',
    queryFn: api.threads.queries.listThreads,
    args: {},
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.threads.mutations.updateChatThread, {
            threadId: m.key,
            title: m.modified.title,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.threads.mutations.deleteChatThread, {
            threadId: m.key,
          }),
        ),
      );
    },
  });

export type { Thread };
