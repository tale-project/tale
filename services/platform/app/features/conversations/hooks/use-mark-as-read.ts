import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useMarkAsRead() {
  return useMutation(api.conversations.markConversationAsRead).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.conversations.getConversationWithMessages,
        { conversationId: args.conversationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.conversations.getConversationWithMessages,
          { conversationId: args.conversationId },
          { ...current, unread_count: 0, last_read_at: new Date().toISOString() }
        );
      }
    }
  );
}
