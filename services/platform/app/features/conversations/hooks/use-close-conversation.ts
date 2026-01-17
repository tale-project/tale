import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCloseConversation() {
  return useMutation(api.conversations.closeConversation).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.conversations.getConversationWithMessages,
        { conversationId: args.conversationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.conversations.getConversationWithMessages,
          { conversationId: args.conversationId },
          { ...current, status: 'closed' }
        );
      }
    }
  );
}
