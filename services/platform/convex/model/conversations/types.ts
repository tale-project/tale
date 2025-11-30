/**
 * Type definitions for conversation model
 */

import { v } from 'convex/values';
import type { Id, Doc } from '../../_generated/dataModel';
import {
  approvalItemValidator,
  ApprovalResourceType,
} from '../approvals/types';

// =============================================================================
// TYPESCRIPT INTERFACES
// =============================================================================

export interface CreateConversationArgs {
  organizationId: string;
  customerId?: Id<'customers'>;
  externalMessageId?: string;
  subject?: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  type?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  providerId?: Id<'emailProviders'>;

  metadata?: unknown;
}

export interface CreateConversationResult {
  success: boolean;
  conversationId: string;
}

export interface UpdateConversationsArgs {
  conversationId?: Id<'conversations'>;
  organizationId?: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;

  updates: unknown;
}

export interface UpdateConversationsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'conversations'>[];
}

export interface QueryConversationsArgs {
  organizationId: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  customerId?: Id<'customers'>;

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export interface QueryConversationsResult {
  page: Array<Doc<'conversations'>>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export interface MessageInfo {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  isCustomer: boolean;
  status: string;
  attachment?: unknown;
}

export interface CustomerInfo {
  id: string;
  name?: string;
  email: string;
  locale?: string;
  status: string;
  source?: string;
  created_at: string;
}

export interface ConversationItem {
  _id: Id<'conversations'>;
  _creationTime: number;
  organizationId: string;
  customerId?: Id<'customers'>;
  externalMessageId?: string;
  subject?: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  type?: string;
  channel?: string;

  metadata?: unknown;
  // Computed fields
  id: string;
  title: string;
  description: string;
  customer_id: string;
  business_id: string;
  message_count: number;
  unread_count: number;
  last_message_at?: string;
  last_read_at?: string;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
  updated_at: string;
  customer: CustomerInfo;
  messages: MessageInfo[];
  pendingApproval?: {
    _id: Id<'approvals'>;
    _creationTime: number;
    organizationId: string;
    wfExecutionId?: Id<'wfExecutions'>;
    stepSlug?: string;
    status: 'pending' | 'approved' | 'rejected';
    approvedBy?: string;
    reviewedAt?: number;
    resourceType: ApprovalResourceType;
    resourceId: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dueDate?: number;
    metadata?: unknown;
  };
}

export interface ConversationListResponse {
  conversations: ConversationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BulkOperationResult {
  successCount: number;
  failedCount: number;
  errors: string[];
}

// =============================================================================
// VALIDATORS (for Convex function args/returns)
// =============================================================================

/**
 * Conversation status validator
 */
export const conversationStatusValidator = v.union(
  v.literal('open'),
  v.literal('closed'),
  v.literal('spam'),
  v.literal('archived'),
);

/**
 * Conversation priority validator
 */
export const conversationPriorityValidator = v.union(
  v.literal('low'),
  v.literal('normal'),
  v.literal('high'),
  v.literal('urgent'),
);

/**
 * Message validator
 */
export const messageValidator = v.object({
  id: v.string(),
  sender: v.string(),
  content: v.string(),
  timestamp: v.string(),
  isCustomer: v.boolean(),
  status: v.string(),
  attachment: v.optional(v.any()),
});

/**
 * Customer info validator (for conversation responses)
 */
export const customerInfoValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  email: v.string(),
  locale: v.optional(v.string()),
  status: v.string(),
  source: v.optional(v.string()),
  created_at: v.string(),
});

/**
 * Conversation item validator (for list responses)
 */
export const conversationItemValidator = v.object({
  _id: v.id('conversations'),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
  providerId: v.optional(v.id('emailProviders')),

  metadata: v.optional(v.any()),
  // Computed fields for frontend compatibility
  id: v.string(),
  title: v.string(),
  description: v.string(),
  customer_id: v.string(),
  business_id: v.string(),
  message_count: v.number(),
  unread_count: v.number(),
  last_message_at: v.optional(v.string()),
  last_read_at: v.optional(v.string()),
  resolved_at: v.optional(v.string()),
  resolved_by: v.optional(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
  customer: customerInfoValidator,
  messages: v.array(messageValidator),
  pendingApproval: v.optional(approvalItemValidator),
});

/**
 * Conversation list response validator
 */
export const conversationListResponseValidator = v.object({
  conversations: v.array(conversationItemValidator),
  total: v.number(),
  page: v.number(),
  limit: v.number(),
  totalPages: v.number(),
});

/**
 * Conversation with messages validator
 */
export const conversationWithMessagesValidator = v.object({
  _id: v.id('conversations'),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
  providerId: v.optional(v.id('emailProviders')),

  metadata: v.optional(v.any()),
  // Computed fields
  id: v.string(),
  title: v.string(),
  description: v.string(),
  customer_id: v.string(),
  business_id: v.string(),
  message_count: v.number(),
  unread_count: v.number(),
  last_message_at: v.optional(v.string()),
  last_read_at: v.optional(v.string()),
  resolved_at: v.optional(v.string()),
  resolved_by: v.optional(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
  customer: customerInfoValidator,
  messages: v.array(messageValidator),
  pendingApproval: v.optional(approvalItemValidator),
});

/**
 * Bulk operation result validator
 */
export const bulkOperationResultValidator = v.object({
  successCount: v.number(),
  failedCount: v.number(),
  errors: v.array(v.string()),
});
