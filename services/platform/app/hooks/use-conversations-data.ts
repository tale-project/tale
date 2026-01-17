import { api } from '@/convex/_generated/api';
import { createEntityDataHook } from './use-entity-data-factory';
import type { SortOrder } from '@/lib/utils/client-utils';

type ConversationSortBy = 'createdAt' | 'lastMessageAt' | 'priority' | 'status';

interface ConversationFilters {
  status: string[];
  priority: string[];
  channel: string[];
}

const useConversationsDataBase = createEntityDataHook({
  queryFn: api.queries.conversations.getAllConversations,
  searchFields: ['subject', 'externalMessageId'],
  sortConfig: {
    string: ['priority', 'status'] as ConversationSortBy[],
    date: ['createdAt', 'lastMessageAt'] as ConversationSortBy[],
    number: [] as ConversationSortBy[],
    fieldMap: { createdAt: '_creationTime' },
  },
  defaultSort: { field: 'lastMessageAt' as ConversationSortBy, order: 'desc' as SortOrder },
});

interface UseConversationsDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  priority?: string[];
  channel?: string[];
  sortBy?: ConversationSortBy;
  sortOrder?: SortOrder;
}

export function useConversationsData(options: UseConversationsDataOptions) {
  const { status = [], priority = [], channel = [], ...rest } = options;

  return useConversationsDataBase({
    ...rest,
    filters: { status, priority, channel } as ConversationFilters,
  });
}
