/**
 * Conversation types derived from Convex query return types
 * This file re-exports types from Convex to avoid duplication
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

// Extract the return type from getConversationWithMessages query
export type ConversationWithMessages = NonNullable<
  ReturnsOf<'conversations/queries:getConversationWithMessages'>
>;

// Extract nested types from the conversation
export type Conversation = ConversationWithMessages;
export type Message = ConversationWithMessages['messages'][number];
