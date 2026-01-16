import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Bulk operation - affects multiple items with complex selection
export function useBulkCloseConversations() {
  return useMutation(api.conversations.bulkCloseConversations);
}
