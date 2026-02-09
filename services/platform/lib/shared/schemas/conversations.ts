import { z } from 'zod/v4';

import { prioritySchema } from './common';
import { jsonRecordSchema } from './utils/json-value';

const conversationStatusLiterals = [
  'open',
  'closed',
  'spam',
  'archived',
] as const;
export const conversationStatusSchema = z.enum(conversationStatusLiterals);
type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const conversationPrioritySchema = prioritySchema;
type ConversationPriority = z.infer<typeof conversationPrioritySchema>;

const messageStatusLiterals = [
  'queued',
  'sent',
  'delivered',
  'failed',
] as const;
export const messageStatusSchema = z.enum(messageStatusLiterals);
type MessageStatus = z.infer<typeof messageStatusSchema>;

const messageDirectionLiterals = ['inbound', 'outbound'] as const;
export const messageDirectionSchema = z.enum(messageDirectionLiterals);
type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const attachmentSchema = z.object({
  url: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
  size: z.number().optional(),
});
type Attachment = z.infer<typeof attachmentSchema>;

export const messageSchema = z.object({
  id: z.string(),
  sender: z.string(),
  content: z.string(),
  timestamp: z.string(),
  isCustomer: z.boolean(),
  status: messageStatusSchema,
  attachment: attachmentSchema.optional(),
});
type Message = z.infer<typeof messageSchema>;

export const customerInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string(),
  locale: z.string().optional(),
  status: z.string(),
  source: z.string().optional(),
  created_at: z.string(),
});
type CustomerInfo = z.infer<typeof customerInfoSchema>;

export const conversationItemSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  customerId: z.string().optional(),
  externalMessageId: z.string().optional(),
  subject: z.string().optional(),
  status: conversationStatusSchema.optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  channel: z.string().optional(),
  direction: messageDirectionSchema.optional(),
  providerId: z.string().optional(),
  lastMessageAt: z.number().optional(),
  metadata: jsonRecordSchema.optional(),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  customer_id: z.string(),
  business_id: z.string(),
  message_count: z.number(),
  unread_count: z.number(),
  last_message_at: z.string().optional(),
  last_read_at: z.string().optional(),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  customer: customerInfoSchema,
  messages: z.array(messageSchema),
});
type ConversationItem = z.infer<typeof conversationItemSchema>;

const conversationListResponseSchema = z.object({
  conversations: z.array(conversationItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});
type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const conversationWithMessagesSchema = conversationItemSchema;
type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

export const bulkOperationResultSchema = z.object({
  successCount: z.number(),
  failedCount: z.number(),
  errors: z.array(z.string()),
});
type BulkOperationResult = z.infer<typeof bulkOperationResultSchema>;

const conversationDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  customerId: z.string().optional(),
  externalMessageId: z.string().optional(),
  subject: z.string().optional(),
  status: conversationStatusSchema.optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  channel: z.string().optional(),
  direction: messageDirectionSchema.optional(),
  providerId: z.string().optional(),
  lastMessageAt: z.number().optional(),
  metadata: jsonRecordSchema.optional(),
});
type ConversationDoc = z.infer<typeof conversationDocSchema>;
