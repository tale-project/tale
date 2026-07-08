import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

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
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  channel?: string;
  /** Filter to one connected inbox provider (e.g. `gmail`) — the Inbox
   *  toolbar's channel filter. */
  integrationName?: string;
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

export function useApproxConversationCountByStatus(
  organizationId: string,
  status: 'open' | 'closed' | 'spam' | 'archived',
) {
  return useConvexQuery(
    api.conversations.queries.approxCountConversationsByStatus,
    {
      organizationId,
      status,
    },
  );
}

export function useConversationWithMessages(conversationId: string | null) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    conversationId && organizationId
      ? {
          conversationId: toId<'conversations'>(conversationId),
          organizationId,
        }
      : 'skip',
  );
}
