import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Conversation } from '@/lib/collections/entities/conversations';

import { createConversationsCollection } from '@/lib/collections/entities/conversations';
import { useCollection } from '@/lib/collections/use-collection';

export function useConversationCollection(organizationId: string) {
  return useCollection(
    'conversations',
    createConversationsCollection,
    organizationId,
  );
}

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
