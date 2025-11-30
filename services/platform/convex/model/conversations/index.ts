/**
 * Conversations Model - Index
 *
 * Central export point for all conversation model functions
 */

// Export types
export type {
  CreateConversationArgs,
  CreateConversationResult,
  UpdateConversationsArgs,
  UpdateConversationsResult,
  QueryConversationsArgs,
  QueryConversationsResult,
  MessageInfo,
  CustomerInfo,
  ConversationItem,
  ConversationListResponse,
  BulkOperationResult,
} from './types';

// Export validators
export {
  conversationStatusValidator,
  conversationPriorityValidator,
  messageValidator,
  customerInfoValidator,
  conversationItemValidator,
  conversationListResponseValidator,
  conversationWithMessagesValidator,
  bulkOperationResultValidator,
} from './types';

// Export functions
export { createConversation } from './create_conversation';
export { createConversationWithMessage } from './create_conversation_with_message';
export type {
  CreateConversationWithMessageArgs,
  CreateConversationWithMessageResult,
} from './create_conversation_with_message';
export { getConversationById } from './get_conversation_by_id';
export { getConversationByExternalMessageId } from './get_conversation_by_external_message_id';
export { getMessageByExternalId } from './get_message_by_external_id';
export { queryConversations } from './query_conversations';
export { queryLatestMessageByDeliveryState } from './query_latest_message_by_delivery_state';
export type {
  QueryLatestMessageByDeliveryStateArgs,
  QueryLatestMessageByDeliveryStateResult,
} from './query_latest_message_by_delivery_state';
export { updateConversations } from './update_conversations';
export { getConversations } from './get_conversations';
export { getConversationsPage } from './get_conversations_page';
export { getConversationWithMessages } from './get_conversation_with_messages';

export { createConversationPublic } from './create_conversation_public';
export { updateConversation } from './update_conversation';
export { updateConversationMessage } from './update_conversation_message';
export { deleteConversation } from './delete_conversation';
export { addMessageToConversation } from './add_message_to_conversation';
export { closeConversation } from './close_conversation';
export { reopenConversation } from './reopen_conversation';
export { markConversationAsSpam } from './mark_conversation_as_spam';
export { markConversationAsRead } from './mark_conversation_as_read';
export { bulkCloseConversations } from './bulk_close_conversations';
export { bulkReopenConversations } from './bulk_reopen_conversations';
export { transformConversation } from './transform_conversation';
export { sendMessageViaEmail } from './send_message_via_email';
export type { SendMessageViaEmailArgs } from './send_message_via_email';
