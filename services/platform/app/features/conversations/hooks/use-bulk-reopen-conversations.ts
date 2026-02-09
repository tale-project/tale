import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: Bulk operation - affects multiple items with complex selection
export function useBulkReopenConversations() {
  return useMutation(api.conversations.mutations.bulkReopenConversations);
}
