/**
 * Type definitions for conversation model
 */

import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import {
  bulkOperationResultValidator,
  conversationItemValidator,
  conversationListResponseValidator,
  conversationPriorityValidator,
  conversationStatusValidator,
  conversationWithMessagesValidator,
  customerInfoValidator,
  messageStatusValidator,
  messageValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type ConversationStatus = Infer<typeof conversationStatusValidator>;
export type ConversationPriority = Infer<typeof conversationPriorityValidator>;
export type MessageStatus = Infer<typeof messageStatusValidator>;
export type MessageInfo = Infer<typeof messageValidator>;
export type CustomerInfo = Infer<typeof customerInfoValidator>;
export type ConversationItem = Infer<typeof conversationItemValidator>;
export type ConversationListResponse = Infer<
  typeof conversationListResponseValidator
>;
export type ConversationWithMessages = Infer<
  typeof conversationWithMessagesValidator
>;
export type BulkOperationResult = Infer<typeof bulkOperationResultValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface CreateConversationArgs {
  organizationId: string;
  customerId?: Id<'customers'>;
  externalMessageId?: string;
  subject?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  type?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  providerId?: Id<'emailProviders'>;

  metadata?: unknown;
}

/** Partial updates for conversation fields */
export interface ConversationUpdates {
  customerId?: Id<'customers'>;
  subject?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateConversationsArgs {
  conversationId?: Id<'conversations'>;
  organizationId?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;

  updates: ConversationUpdates;
}

export interface UpdateConversationsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'conversations'>[];
}

export interface QueryConversationsArgs {
  organizationId: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  customerId?: Id<'customers'>;

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}
