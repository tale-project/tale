import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useMarkAsSpam() {
  return useMutation(api.conversations.mutations.markConversationAsSpam).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.conversations.queries.getConversationWithMessages,
        { conversationId: args.conversationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.conversations.queries.getConversationWithMessages,
          { conversationId: args.conversationId },
          { ...current, status: 'spam' }
        );
      }
    }
  );
}
