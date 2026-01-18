import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useMarkAsRead() {
  return useMutation(api.conversations.mutations.markConversationAsRead).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.conversations.queries.getConversationWithMessages,
        { conversationId: args.conversationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.conversations.queries.getConversationWithMessages,
          { conversationId: args.conversationId },
          { ...current, unread_count: 0, last_read_at: new Date().toISOString() }
        );
      }
    }
  );
}
