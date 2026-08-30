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
 * Pure: callers fetch, this projects.
 */

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
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function projectConversationMessage(
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
    // An unsent message has no timestamp of its own — the UI renders the
    // empty string as "just now" rather than inventing a send time.
    timestamp:
      message.sentAt !== null && message.sentAt !== undefined
        ? new Date(message.sentAt).toISOString()
        : '',
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
}): Record<string, unknown> {
  const { conversation } = args;
  const metadata = isRecord(conversation.metadata) ? conversation.metadata : {};
  const messages = args.messages.map(projectConversationMessage);
  // A missing name stays undefined so the client renders its localized
  // fallback instead of a hardcoded English string.
  const contact =
    args.contact === null
      ? {
          id: conversation.contactId ?? 'unknown',
          email: 'unknown@example.com',
          locale: 'en',
          source: 'unknown',
          created_at: new Date(conversation.createdAt).toISOString(),
        }
      : {
          id: args.contact.id,
          ...(args.contact.name ? { name: args.contact.name } : {}),
          email: args.contact.email || 'unknown@example.com',
          locale: args.contact.locale || 'en',
          source: args.contact.source || 'unknown',
          created_at: new Date(args.contact.createdAt).toISOString(),
        };
  const lastMessage = messages[messages.length - 1];
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
    ...(conversation.lastMessageAt !== null &&
    conversation.lastMessageAt !== undefined
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
    last_message_at:
      conversation.lastMessageAt !== null &&
      conversation.lastMessageAt !== undefined
        ? new Date(conversation.lastMessageAt).toISOString()
        : lastMessage !== undefined
          ? lastMessage.timestamp
          : new Date(conversation.createdAt).toISOString(),
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
    created_at: new Date(conversation.createdAt).toISOString(),
    updated_at: new Date(conversation.createdAt).toISOString(),
    contact,
    messages,
    ...(args.pendingApproval ? { pendingApproval: args.pendingApproval } : {}),
    ...(contact.name !== undefined ? { senderName: contact.name } : {}),
    ...(lastMessage !== undefined
      ? {
          lastMessagePreview: lastMessage.content.slice(
            0,
            LAST_MESSAGE_PREVIEW_MAX_CHARS,
          ),
        }
      : {}),
  };
}
