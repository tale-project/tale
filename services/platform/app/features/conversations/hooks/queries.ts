import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Conversation } from '@/lib/collections/entities/conversations';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useConversations(collection: Collection<Conversation, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    conversations: data,
    isLoading,
  };
}

interface ListConversationsPaginatedArgs {
  organizationId: string;
  status?: string;
  priority?: string;
  channel?: string;
  initialNumItems: number;
}

export function useListConversationsPaginated(
  args: ListConversationsPaginatedArgs,
) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.conversations.queries.listConversationsPaginated,
    queryArgs,
    { initialNumItems },
  );
}

export function useConversationWithMessages(conversationId: string | null) {
  return useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    conversationId
      ? { conversationId: toId<'conversations'>(conversationId) }
      : 'skip',
  );
}
