import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export type Conversation = ConvexItemOf<
  typeof api.conversations.queries.listConversations
>;

export function useConversations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.conversations.queries.listConversations,
    { organizationId },
  );

  return {
    conversations: data ?? [],
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

export function useHasConversations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.conversations.queries.hasConversations,
    { organizationId },
  );

  return {
    hasConversations: data ?? false,
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
