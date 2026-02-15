/**
 * Convex validators for conversation operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  conversationStatusSchema,
  conversationPrioritySchema,
  messageStatusSchema,
  messageDirectionSchema,
  messageSchema,
  customerInfoSchema,
  attachmentSchema,
  emailAttachmentMetaSchema,
  bulkOperationResultSchema,
} from '../../lib/shared/schemas/conversations';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  conversationStatusSchema,
  conversationPrioritySchema,
  messageStatusSchema,
  messageDirectionSchema,
  messageSchema,
  customerInfoSchema,
  conversationItemSchema,
  attachmentSchema,
  emailAttachmentMetaSchema,
  conversationWithMessagesSchema,
} from '../../lib/shared/schemas/conversations';
import { approvalItemValidator } from '../approvals/validators';

// Simple schemas without z.lazy()
export const conversationStatusValidator = zodToConvex(
  conversationStatusSchema,
);
export const conversationPriorityValidator = zodToConvex(
  conversationPrioritySchema,
);
export const messageStatusValidator = zodToConvex(messageStatusSchema);
export const messageDirectionValidator = zodToConvex(messageDirectionSchema);
export const messageValidator = zodToConvex(messageSchema);
export const customerInfoValidator = zodToConvex(customerInfoSchema);
export const attachmentValidator = zodToConvex(attachmentSchema);
export const emailAttachmentMetaValidator = zodToConvex(
  emailAttachmentMetaSchema,
);
export const bulkOperationResultValidator = zodToConvex(
  bulkOperationResultSchema,
);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const conversationItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.string()),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(messageDirectionValidator),
  integrationName: v.optional(v.string()),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
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
  pendingApproval: v.optional(v.union(approvalItemValidator, v.null())),
});

export const conversationListResponseValidator = v.object({
  conversations: v.array(conversationItemValidator),
  total: v.number(),
  page: v.number(),
  limit: v.number(),
  totalPages: v.number(),
});

export const conversationDocValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.string()),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(messageDirectionValidator),
  integrationName: v.optional(v.string()),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

export const conversationWithMessagesValidator = conversationItemValidator;
