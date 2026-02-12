import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexAction(api.files.actions.generateUploadUrl);
}

export function useAddMessage() {
  return useConvexAction(api.conversations.actions.addMessageToConversation);
}

export function useBulkCloseConversations() {
  return useConvexAction(api.conversations.actions.bulkCloseConversations);
}

export function useBulkReopenConversations() {
  return useConvexAction(api.conversations.actions.bulkReopenConversations);
}

export function useSendMessageViaIntegration() {
  return useConvexAction(api.conversations.actions.sendMessageViaIntegration);
}
