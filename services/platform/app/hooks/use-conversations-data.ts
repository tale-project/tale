import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { api } from '@/convex/_generated/api';
import {
  filterByFields,
  filterByTextSearch,
  sortByDate,
  sortByString,
  type SortOrder,
} from '@/lib/utils/client-utils';

interface UseConversationsDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  priority?: string[];
  channel?: string[];
  sortBy?: 'createdAt' | 'lastMessageAt' | 'priority' | 'status';
  sortOrder?: SortOrder;
}

export function useConversationsData(options: UseConversationsDataOptions) {
  const {
    organizationId,
    search = '',
    status = [],
    priority = [],
    channel = [],
    sortBy = 'lastMessageAt',
    sortOrder = 'desc',
  } = options;

  const allConversations = useQuery(
    api.queries.conversations.getAllConversations,
    { organizationId },
  );

  const processed = useMemo(() => {
    if (!allConversations) return [];

    let result = allConversations;

    if (search) {
      result = filterByTextSearch(result, search, [
        'subject',
        'externalMessageId',
      ]);
    }

    const filters = [];
    if (status.length > 0) {
      filters.push({ field: 'status' as const, values: new Set(status) });
    }
    if (priority.length > 0) {
      filters.push({ field: 'priority' as const, values: new Set(priority) });
    }
    if (channel.length > 0) {
      filters.push({ field: 'channel' as const, values: new Set(channel) });
    }

    if (filters.length > 0) {
      result = filterByFields(result, filters);
    }

    return [...result].sort(
      sortBy === 'createdAt' || sortBy === 'lastMessageAt'
        ? sortByDate(sortBy === 'createdAt' ? '_creationTime' : sortBy, sortOrder)
        : sortByString(sortBy, sortOrder),
    );
  }, [allConversations, search, status, priority, channel, sortBy, sortOrder]);

  return {
    data: processed,
    totalCount: allConversations?.length ?? 0,
    filteredCount: processed.length,
    isLoading: allConversations === undefined,
  };
}
