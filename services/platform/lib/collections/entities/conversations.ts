import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Conversation = ConvexItemOf<
  typeof api.conversations.queries.listConversations
>;

export const createConversationsCollection: CollectionFactory<
  Conversation,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'conversations',
    queryFn: api.conversations.queries.listConversations,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.flatMap((m) => {
          const promises: Promise<unknown>[] = [];
          const { changes } = m;
          const conversationId = toId<'conversations'>(m.key);

          if (changes.status === 'closed') {
            promises.push(
              convexClient.mutation(
                api.conversations.mutations.closeConversation,
                { conversationId },
              ),
            );
          } else if (changes.status === 'open') {
            promises.push(
              convexClient.mutation(
                api.conversations.mutations.reopenConversation,
                { conversationId },
              ),
            );
          } else if (changes.status === 'spam') {
            promises.push(
              convexClient.mutation(
                api.conversations.mutations.markConversationAsSpam,
                { conversationId },
              ),
            );
          }

          if (changes.unread_count === 0) {
            promises.push(
              convexClient.mutation(
                api.conversations.mutations.markConversationAsRead,
                { conversationId },
              ),
            );
          }

          return promises;
        }),
      );
    },
  });

export type { Conversation };
