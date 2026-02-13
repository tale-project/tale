import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Conversation } from '@/lib/collections/entities/conversations';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useAddMessage() {
  return useConvexMutation(
    api.conversations.mutations.addMessageToConversation,
  );
}

export function useBulkCloseConversations() {
  return useConvexMutation(api.conversations.mutations.bulkCloseConversations);
}

export function useBulkReopenConversations() {
  return useConvexMutation(api.conversations.mutations.bulkReopenConversations);
}

export function useSendMessageViaIntegration() {
  return useConvexMutation(
    api.conversations.mutations.sendMessageViaIntegration,
  );
}

export function useCloseConversation(
  collection: Collection<Conversation, string>,
) {
  return useCallback(
    async (args: { conversationId: string }) => {
      const tx = collection.update(args.conversationId, (draft) => {
        draft.status = 'closed';
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useReopenConversation(
  collection: Collection<Conversation, string>,
) {
  return useCallback(
    async (args: { conversationId: string }) => {
      const tx = collection.update(args.conversationId, (draft) => {
        draft.status = 'open';
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useMarkAsRead(collection: Collection<Conversation, string>) {
  return useCallback(
    async (args: { conversationId: string }) => {
      const tx = collection.update(args.conversationId, (draft) => {
        draft.unread_count = 0;
        draft.last_read_at = new Date().toISOString();
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useMarkAsSpam(collection: Collection<Conversation, string>) {
  return useCallback(
    async (args: { conversationId: string }) => {
      const tx = collection.update(args.conversationId, (draft) => {
        draft.status = 'spam';
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
