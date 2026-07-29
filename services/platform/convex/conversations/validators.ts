/**
 * Convex validators for conversation operations
 *
 * Uses native Convex v.* validators to avoid pulling zod into the query bundle.
 * Zod schemas for client-side validation live in lib/shared/schemas/conversations.ts.
 */

import { v } from 'convex/values';

import { approvalItemValidator } from '../approvals/validators';

export const conversationStatusValidator = v.union(
  v.literal('open'),
  v.literal('closed'),
  v.literal('spam'),
  v.literal('archived'),
);

export const conversationPriorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

export const messageStatusValidator = v.union(
  v.literal('queued'),
  v.literal('sent'),
  v.literal('delivered'),
  v.literal('failed'),
);

export const messageDirectionValidator = v.union(
  v.literal('inbound'),
  v.literal('outbound'),
);

export const attachmentValidator = v.object({
  url: v.string(),
  filename: v.string(),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
});

export const emailAttachmentMetaValidator = v.object({
  id: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  storageId: v.optional(v.string()),
  url: v.optional(v.string()),
  contentId: v.optional(v.string()),
});

export const messageValidator = v.object({
  id: v.string(),
  sender: v.string(),
  content: v.string(),
  timestamp: v.string(),
  isCustomer: v.boolean(),
  status: messageStatusValidator,
  // Epoch ms the delayed send action fires (queued outbound only) — drives
  // the composer's "Sending in Ns · Undo" countdown.
  scheduledSendAt: v.optional(v.number()),
  // Delivery failure reason (failed outbound only), e.g. an SMTP error.
  errorMessage: v.optional(v.string()),
  attachment: v.optional(attachmentValidator),
  attachments: v.optional(v.array(emailAttachmentMetaValidator)),
});

export const contactInfoValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  email: v.string(),
  locale: v.optional(v.string()),
  source: v.optional(v.string()),
  created_at: v.string(),
});

export const bulkOperationResultValidator = v.object({
  successCount: v.number(),
  failedCount: v.number(),
  errors: v.array(v.string()),
});

export const conversationItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  contactId: v.optional(v.string()),
  // Internal member owner (Better Auth userId). Surfaced so the conversation
  // header can show the current assignee and gate the admin picker.
  assigneeUserId: v.optional(v.string()),
  // Internal team the conversation is queued to (Better Auth teamId). Surfaced
  // so the header can show the team chip and gate the admin picker.
  assigneeTeamId: v.optional(v.string()),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(messageDirectionValidator),
  connectorName: v.optional(v.string()),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
  id: v.string(),
  title: v.string(),
  description: v.string(),
  contact_id: v.string(),
  business_id: v.string(),
  message_count: v.number(),
  unread_count: v.number(),
  // Flat list-row fields for the ConversationList block (single-level item
  // map): the contact's display name and the latest message's raw content,
  // capped server-side. Optional — absent when there is no named contact /
  // no message yet.
  senderName: v.optional(v.string()),
  lastMessagePreview: v.optional(v.string()),
  last_message_at: v.optional(v.string()),
  last_read_at: v.optional(v.string()),
  resolved_at: v.optional(v.string()),
  resolved_by: v.optional(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
  contact: contactInfoValidator,
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
  contactId: v.optional(v.string()),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(messageDirectionValidator),
  connectorName: v.optional(v.string()),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
});

export const conversationWithMessagesValidator = conversationItemValidator;
