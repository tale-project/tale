import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useAddMessage() {
  return useConvexMutation(
    api.conversations.mutations.addMessageToConversation,
    {
      invalidates: [api.conversations.queries.getConversationWithMessages],
    },
  );
}

export function useBulkCloseConversations() {
  return useConvexOptimisticMutation(
    api.conversations.mutations.bulkCloseConversations,
    api.conversations.queries.listConversations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ conversationIds }, { bulkUpdate }) =>
        bulkUpdate(conversationIds, { status: 'closed' }),
    },
  );
}

export function useBulkReopenConversations() {
  return useConvexOptimisticMutation(
    api.conversations.mutations.bulkReopenConversations,
    api.conversations.queries.listConversations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ conversationIds }, { bulkUpdate }) =>
        bulkUpdate(conversationIds, { status: 'open' }),
    },
  );
}

export function useSendMessageViaIntegration() {
  return useConvexMutation(
    api.conversations.mutations.sendMessageViaIntegration,
    {
      invalidates: [api.conversations.queries.getConversationWithMessages],
    },
  );
}

export function useCloseConversation() {
  return useConvexOptimisticMutation(
    api.conversations.mutations.closeConversation,
    api.conversations.queries.listConversations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ conversationId }, { update }) =>
        update(conversationId, { status: 'closed' }),
    },
  );
}

export function useReopenConversation() {
  return useConvexOptimisticMutation(
    api.conversations.mutations.reopenConversation,
    api.conversations.queries.listConversations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ conversationId }, { update }) =>
        update(conversationId, { status: 'open' }),
    },
  );
}

export function useMarkAsRead() {
  return useConvexMutation(api.conversations.mutations.markConversationAsRead, {
    invalidates: [api.conversations.queries.listConversations],
  });
}

export function useMarkAsSpam() {
  return useConvexOptimisticMutation(
    api.conversations.mutations.markConversationAsSpam,
    api.conversations.queries.listConversations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ conversationId }, { update }) =>
        update(conversationId, { status: 'spam' }),
    },
  );
}

export function useDownloadAttachments() {
  return useConvexMutation(api.conversations.mutations.downloadAttachments);
}
