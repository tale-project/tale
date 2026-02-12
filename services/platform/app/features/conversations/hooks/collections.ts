import { createConversationsCollection } from '@/lib/collections/entities/conversations';
import { useCollection } from '@/lib/collections/use-collection';

export function useConversationCollection(organizationId: string) {
  return useCollection(
    'conversations',
    createConversationsCollection,
    organizationId,
  );
}
