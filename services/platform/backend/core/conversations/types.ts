/**
 * Type definitions for conversation operations. Zod schemas for client-side
 * validation live in lib/shared/schemas/conversations.ts.
 */

import type { ApprovalItem } from '../approvals/types';
import type { Id } from '../lib/rows';

export type ConversationStatus = 'open' | 'closed' | 'spam' | 'archived';

export type ConversationPriority = 'low' | 'medium' | 'high' | 'urgent';

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed';

export type MessageDirection = 'inbound' | 'outbound';

export interface AttachmentInfo {
  url: string;
  filename: string;
  contentType?: string;
  size?: number;
}

export interface EmailAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storageId?: string;
  url?: string;
  contentId?: string;
}

export interface MessageInfo {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  isCustomer: boolean;
  status: MessageStatus;
  /** Epoch ms the delayed send action fires (queued outbound only) — drives
   * the composer's "Sending in Ns · Undo" countdown. */
  scheduledSendAt?: number;
  /** Delivery failure reason (failed outbound only), e.g. an SMTP error. */
  errorMessage?: string;
  attachment?: AttachmentInfo;
  attachments?: EmailAttachmentMeta[];
}

export interface ContactInfo {
  id: string;
  name?: string;
  email: string;
  locale?: string;
  source?: string;
  created_at: string;
}

export interface BulkOperationResult {
  successCount: number;
  failedCount: number;
  errors: string[];
}

export interface ConversationItem {
  _id: string;
  _creationTime: number;
  organizationId: string;
  contactId?: string;
  /** Internal member owner (Better Auth userId). Surfaced so the conversation
   * header can show the current assignee and gate the admin picker. */
  assigneeUserId?: string;
  /** Internal team the conversation is queued to (Better Auth teamId).
   * Surfaced so the header can show the team chip and gate the admin
   * picker. */
  assigneeTeamId?: string;
  externalMessageId?: string;
  subject?: string;
  status?: ConversationStatus;
  priority?: string;
  type?: string;
  channel?: string;
  direction?: MessageDirection;
  connectorName?: string;
  lastMessageAt?: number;
  metadata?: Record<string, unknown>;
  id: string;
  title: string;
  description: string;
  contact_id: string;
  business_id: string;
  message_count: number;
  unread_count: number;
  /** Flat list-row fields for the ConversationList block (single-level item
   * map): the contact's display name and the latest message's raw content,
   * capped server-side. Optional — absent when there is no named contact /
   * no message yet. */
  senderName?: string;
  lastMessagePreview?: string;
  last_message_at?: string;
  last_read_at?: string;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
  updated_at: string;
  contact: ContactInfo;
  messages: MessageInfo[];
  pendingApproval?: ApprovalItem | null;
}

export interface ConversationListResponse {
  conversations: ConversationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ConversationWithMessages = ConversationItem;

// =============================================================================
// MANUAL TYPES
// =============================================================================

export interface CreateConversationArgs {
  organizationId: string;
  contactId?: Id<'contacts'>;
  /** Internal member owner (Better Auth userId). Absent ⇒ unassigned. */
  assigneeUserId?: string;
  externalMessageId?: string;
  subject?: string;
  status?: ConversationStatus;
  priority?: ConversationPriority;
  type?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  connectorName?: string;

  metadata?: unknown;
}

/** Partial updates for conversation fields */
export interface ConversationUpdates {
  contactId?: Id<'contacts'>;
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
  contactId?: Id<'contacts'>;

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}
