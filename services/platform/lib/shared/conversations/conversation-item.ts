/**
 * The Inbox row/detail projection — ONE definition of the shape the
 * conversation surfaces read, shared by both backends.
 *
 * The UI reads a conversation one level deep (the list block maps flat
 * fields; the panel walks `messages`), so this is where the stored row, its
 * contact and its messages become that view. Keeping it here means the 0.4
 * transform and the 0.5 route cannot drift into two different "same" shapes
 * — a divergence the UI would show as blank previews and missing titles.
 *
 * Pure: callers fetch, this projects. It never throws on a row's stamps: the
 * doors hold every timestamp to `epochMsSchema`, but a row stored before they
 * did may carry one no `Date` can hold — and one such row used to fail its
 * organization's whole Inbox list.
 */

import { isEpochMs } from '@tale/shared/schemas/epoch-ms';

import { getConversationMessageSortTime } from './message-order';
import { cleanMessagePreview } from './message-preview';

const LAST_MESSAGE_PREVIEW_MAX_CHARS = 200;

export interface ProjectableConversation {
  id: string;
  organizationId: string;
  contactId?: string | null;
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  externalMessageId?: string | null;
  subject?: string | null;
  status?: string | null;
  priority?: string | null;
  type?: string | null;
  channel?: string | null;
  direction?: string | null;
  connectorName?: string | null;
  lastMessageAt?: number | null;
  metadata?: Record<string, unknown> | null;
  /** Epoch ms the row was created (0.4's `_creationTime`). */
  createdAt: number;
}

export interface ProjectableContact {
  id: string;
  name?: string | null;
  email?: string | null;
  locale?: string | null;
  source?: string | null;
  createdAt: number;
}

export interface ProjectableMessage {
  id: string;
  direction: string;
  content: string;
  deliveryState?: string | null;
  sentAt?: number | null;
  deliveredAt?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
}

export interface ProjectedMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  isCustomer: boolean;
  status: string;
  scheduledSendAt?: number;
  errorMessage?: string;
  attachment?: {
    url: string;
    filename: string;
    contentType?: string;
    size?: number;
  };
  attachments?: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    storageId?: string;
    url?: string;
    contentId?: string;
    /** The bytes are gone, so this cannot be offered for download. Stamped at
     *  read time from live storage; `url` is absent alongside it. */
    unavailable?: boolean;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ISO 8601 for a stored stamp. The callers fall back to the row's creation
 * time first; a creation time no `Date` can hold renders as the epoch. */
function isoTimestamp(ms: number): string {
  return new Date(isEpochMs(ms) ? ms : 0).toISOString();
}

function projectConversationMessage(
  message: ProjectableMessage,
): ProjectedMessage {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const rawAttachment = metadata.attachment;
  const attachment = isRecord(rawAttachment)
    ? {
        url: String(rawAttachment.url ?? ''),
        filename: String(rawAttachment.filename ?? ''),
        ...(typeof rawAttachment.contentType === 'string'
          ? { contentType: rawAttachment.contentType }
          : {}),
        ...(typeof rawAttachment.size === 'number'
          ? { size: rawAttachment.size }
          : {}),
      }
    : undefined;
  const rawAttachments = metadata.attachments;
  const attachments =
    Array.isArray(rawAttachments) && rawAttachments.length > 0
      ? rawAttachments.filter(isRecord).map((a) => ({
          id: typeof a.id === 'string' ? a.id : '',
          filename: typeof a.filename === 'string' ? a.filename : '',
          contentType:
            typeof a.contentType === 'string'
              ? a.contentType
              : 'application/octet-stream',
          size: typeof a.size === 'number' ? a.size : 0,
          ...(typeof a.storageId === 'string'
            ? { storageId: a.storageId }
            : {}),
          ...(typeof a.url === 'string' ? { url: a.url } : {}),
          ...(typeof a.contentId === 'string'
            ? { contentId: a.contentId }
            : {}),
          ...(a.unavailable === true ? { unavailable: true } : {}),
        }))
      : undefined;
  const deliveryState = message.deliveryState || 'sent';
  return {
    id: message.id,
    sender:
      typeof metadata.sender === 'string'
        ? metadata.sender
        : message.direction === 'inbound'
          ? 'Customer'
          : 'Agent',
    content: message.content,
    // The same time the thread is ordered by: sent, else delivered, else when
    // the row was written. A reply still queued for an API app has no send
    // time until the app acknowledges it, and the thread drops a message
    // without a timestamp, so an empty one hid the reply, its undo and its
    // retry until then. A stamp no `Date` can hold counts as absent.
    timestamp: isoTimestamp(
      getConversationMessageSortTime({
        _id: message.id,
        _creationTime: message.createdAt,
        ...(isEpochMs(message.sentAt) ? { sentAt: message.sentAt } : {}),
        ...(isEpochMs(message.deliveredAt)
          ? { deliveredAt: message.deliveredAt }
          : {}),
      }),
    ),
    isCustomer: message.direction === 'inbound',
    status: deliveryState,
    // The undo countdown's source: meaningful only while still queued —
    // once the send fires the stamp is history, not a schedule.
    ...(deliveryState === 'queued' &&
    typeof metadata.scheduledSendAt === 'number'
      ? { scheduledSendAt: metadata.scheduledSendAt }
      : {}),
    ...(deliveryState === 'failed' && typeof metadata.error === 'string'
      ? { errorMessage: metadata.error }
      : {}),
    ...(attachment !== undefined ? { attachment } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  };
}

export function projectConversationItem(args: {
  conversation: ProjectableConversation;
  contact: ProjectableContact | null;
  messages: ProjectableMessage[];
  pendingApproval?: unknown;
  /** The mailbox (connector credential) the thread belongs to, which is also
   *  the one its reply leaves from. Absent when the server cannot place it. */
  credentialId?: string;
}): Record<string, unknown> {
  const { conversation } = args;
  const metadata = isRecord(conversation.metadata) ? conversation.metadata : {};
  const messages = args.messages.map(projectConversationMessage);
  const missingEmail =
    conversation.channel === 'api' ? '' : 'unknown@example.com';
  // A missing name stays undefined so the client renders its localized
  // fallback instead of a hardcoded English string.
  const contact =
    args.contact === null
      ? {
          id: conversation.contactId ?? 'unknown',
          email: missingEmail,
          locale: 'en',
          source: 'unknown',
          created_at: isoTimestamp(conversation.createdAt),
        }
      : {
          id: args.contact.id,
          ...(args.contact.name ? { name: args.contact.name } : {}),
          email: args.contact.email || missingEmail,
          locale: args.contact.locale || 'en',
          source: args.contact.source || 'unknown',
          created_at: isoTimestamp(args.contact.createdAt),
        };
  const lastMessage = messages[messages.length - 1];
  // Clean the complete raw body before the cap can sever a style block.
  // This is the same plain-text preview the Inbox's raw-message rows use,
  // with link labels and layout cells, not the corpus's Markdown markers.
  const lastRawMessage = args.messages[args.messages.length - 1];
  const lastMessagePreview =
    lastRawMessage !== undefined
      ? cleanMessagePreview(lastRawMessage.content).slice(
          0,
          LAST_MESSAGE_PREVIEW_MAX_CHARS,
        )
      : undefined;
  return {
    _id: conversation.id,
    _creationTime: conversation.createdAt,
    organizationId: conversation.organizationId,
    ...(conversation.contactId ? { contactId: conversation.contactId } : {}),
    ...(conversation.assigneeUserId
      ? { assigneeUserId: conversation.assigneeUserId }
      : {}),
    ...(conversation.assigneeTeamId
      ? { assigneeTeamId: conversation.assigneeTeamId }
      : {}),
    ...(conversation.externalMessageId
      ? { externalMessageId: conversation.externalMessageId }
      : {}),
    ...(conversation.subject ? { subject: conversation.subject } : {}),
    ...(conversation.status ? { status: conversation.status } : {}),
    ...(conversation.priority ? { priority: conversation.priority } : {}),
    ...(conversation.direction ? { direction: conversation.direction } : {}),
    ...(conversation.connectorName
      ? { connectorName: conversation.connectorName }
      : {}),
    ...(args.credentialId ? { credentialId: args.credentialId } : {}),
    ...(isEpochMs(conversation.lastMessageAt)
      ? { lastMessageAt: conversation.lastMessageAt }
      : {}),
    metadata: conversation.metadata ?? undefined,
    id: conversation.id,
    title: conversation.subject || 'Untitled Conversation',
    description:
      (typeof metadata.description === 'string' && metadata.description) ||
      conversation.subject ||
      'No description',
    channel:
      conversation.channel ||
      (typeof metadata.channel === 'string' ? metadata.channel : undefined) ||
      'Email',
    type: conversation.type || 'General',
    contact_id: conversation.contactId ?? 'unknown',
    business_id: conversation.organizationId,
    message_count: messages.length,
    unread_count:
      typeof metadata.unread_count === 'number' ? metadata.unread_count : 0,
    // A cursor no `Date` can hold counts as absent, as a message's stamps
    // do: the newest message dates the row, else its creation.
    last_message_at: isEpochMs(conversation.lastMessageAt)
      ? isoTimestamp(conversation.lastMessageAt)
      : lastMessage !== undefined
        ? lastMessage.timestamp
        : isoTimestamp(conversation.createdAt),
    ...(typeof metadata.last_read_at === 'string'
      ? { last_read_at: metadata.last_read_at }
      : {}),
    ...(conversation.status === 'closed' &&
    typeof metadata.resolved_at === 'string'
      ? { resolved_at: metadata.resolved_at }
      : {}),
    ...(typeof metadata.resolved_by === 'string'
      ? { resolved_by: metadata.resolved_by }
      : {}),
    created_at: isoTimestamp(conversation.createdAt),
    updated_at: isoTimestamp(conversation.createdAt),
    contact,
    messages,
    ...(args.pendingApproval ? { pendingApproval: args.pendingApproval } : {}),
    ...(contact.name !== undefined ? { senderName: contact.name } : {}),
    ...(lastMessagePreview !== undefined ? { lastMessagePreview } : {}),
  };
}
