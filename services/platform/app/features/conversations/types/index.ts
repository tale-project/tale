/**
 * Conversation types derived from Convex query return types
 * This file re-exports types from Convex to avoid duplication
 */

import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

// Extract the return type from getConversationWithMessages query
export type ConversationWithMessages = NonNullable<
  FunctionReturnType<
    typeof api.conversations.queries.getConversationWithMessages
  >
>;

// Extract nested types from the conversation
export type Conversation = ConversationWithMessages;
export type Message = ConversationWithMessages['messages'][number];
