/**
 * Convex validators for conversation model
 */

import { v } from 'convex/values';
import { approvalItemValidator } from '../approvals/validators';

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
 * Message status validator
 * Represents delivery states for conversation messages (from deliveryState field)
 */
export const messageStatusValidator = v.union(
  v.literal('queued'),
  v.literal('sent'),
  v.literal('delivered'),
  v.literal('failed'),
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
  status: messageStatusValidator,
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
  lastMessageAt: v.optional(v.number()),

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
  lastMessageAt: v.optional(v.number()),

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
