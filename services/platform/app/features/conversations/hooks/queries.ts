import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useConversationWithMessages(conversationId: string | null) {
  return useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    conversationId
      ? { conversationId: toId<'conversations'>(conversationId) }
      : 'skip',
  );
}
