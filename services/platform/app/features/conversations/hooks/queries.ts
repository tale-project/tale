import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Conversation } from '@/lib/collections/entities/conversations';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useConversations(collection: Collection<Conversation, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ conversation: collection })
      .select(({ conversation }) => conversation),
  );

  return {
    conversations: data,
    isLoading,
  };
}

export function useConversationWithMessages(conversationId: string | null) {
  return useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    conversationId
      ? { conversationId: toId<'conversations'>(conversationId) }
      : 'skip',
  );
}
