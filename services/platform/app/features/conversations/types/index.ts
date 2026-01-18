/**
 * Conversation types derived from Convex query return types
 * This file re-exports types from Convex to avoid duplication
 */

import { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';

// Extract the return type from getConversationWithMessages query
export type ConversationWithMessages = NonNullable<
  FunctionReturnType<typeof api.conversations.queries.getConversationWithMessages>
>;

// Extract nested types from the conversation
export type Conversation = ConversationWithMessages;
export type Message = ConversationWithMessages['messages'][number];
