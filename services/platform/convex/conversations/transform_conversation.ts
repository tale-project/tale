/**
 * Transform conversation to include computed fields (business logic)
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { ConversationItem, CustomerInfo, MessageInfo } from './types';

import { getPendingApprovalForResource } from '../approvals/helpers';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

export async function transformConversation(
  ctx: QueryCtx,
  conversation: Doc<'conversations'>,
  options?: { includeAllMessages?: boolean },
): Promise<ConversationItem> {
  const includeAllMessages = options?.includeAllMessages ?? false;

  // Load customer and messages in parallel
  const [customerDoc, messageDocs] = await Promise.all([
    conversation.customerId
      ? ctx.db.get(conversation.customerId)
      : Promise.resolve(null),
    (async () => {
      if (includeAllMessages) {
        const docs: Array<Doc<'conversationMessages'>> = [];
        for await (const msg of ctx.db
          .query('conversationMessages')
          .withIndex('by_conversationId_and_deliveredAt', (q) =>
            q.eq('conversationId', conversation._id),
          )) {
          docs.push(msg);
        }
        return docs;
      } else {
        const lastMessage = await ctx.db
          .query('conversationMessages')
          .withIndex('by_conversationId_and_deliveredAt', (q) =>
            q.eq('conversationId', conversation._id),
          )
          .order('desc')
          .first();

        return lastMessage ? [lastMessage] : [];
      }
    })(),
  ]);

  // Build customer info from fetched data
  let customer: CustomerInfo = {
    id: conversation.customerId || 'unknown',
    name: 'Unknown Customer',
    email: 'unknown@example.com',
    locale: 'en',
    status: 'active',
    source: 'unknown',
    created_at: new Date(conversation._creationTime).toISOString(),
  };

  if (customerDoc) {
    const custMeta = customerDoc.metadata ?? {};
    customer = {
      id: customerDoc._id,
      name: customerDoc.name || 'Unknown Customer',
      email: customerDoc.email || 'unknown@example.com',
      locale: typeof custMeta.locale === 'string' ? custMeta.locale : 'en',
      status: typeof custMeta.status === 'string' ? custMeta.status : 'active',
      source: typeof custMeta.source === 'string' ? custMeta.source : 'unknown',
      created_at: new Date(customerDoc._creationTime).toISOString(),
    };
  }

  // Sort messages: first by deliveredAt (null values last), then by _creationTime
  messageDocs.sort((a, b) => {
    // If both have deliveredAt, sort by deliveredAt ascending
    if (a.deliveredAt !== undefined && b.deliveredAt !== undefined) {
      return a.deliveredAt - b.deliveredAt;
    }
    // If only a has null deliveredAt, b comes first
    if (a.deliveredAt === undefined && b.deliveredAt !== undefined) {
      return 1;
    }
    // If only b has null deliveredAt, a comes first
    if (a.deliveredAt !== undefined && b.deliveredAt === undefined) {
      return -1;
    }
    // If both have null deliveredAt, sort by _creationTime ascending
    return a._creationTime - b._creationTime;
  });

  debugLog('messageDocs', messageDocs.length);
  debugLog('conversation', conversation._id);
  const messages: MessageInfo[] = messageDocs.map((m) => {
    let timestamp = '';

    if (m.sentAt !== undefined) {
      timestamp = new Date(m.sentAt).toISOString();
    } else {
      console.warn('Message missing sentAt:', m._id);
    }

    const rawAttachment = m.metadata?.attachment;
    const attachment =
      rawAttachment &&
      typeof rawAttachment === 'object' &&
      rawAttachment !== null
        ? {
            url: String(rawAttachment.url ?? ''),
            filename: String(rawAttachment.filename ?? ''),
            contentType:
              typeof rawAttachment.contentType === 'string'
                ? rawAttachment.contentType
                : undefined,
            size:
              typeof rawAttachment.size === 'number'
                ? rawAttachment.size
                : undefined,
          }
        : undefined;

    const rawAttachments = m.metadata?.attachments;
    const attachments =
      Array.isArray(rawAttachments) && rawAttachments.length > 0
        ? rawAttachments
            .filter(
              (a): a is Record<string, unknown> =>
                typeof a === 'object' && a !== null,
            )
            .map((a) => ({
              id: typeof a.id === 'string' ? a.id : '',
              filename: typeof a.filename === 'string' ? a.filename : '',
              contentType:
                typeof a.contentType === 'string'
                  ? a.contentType
                  : 'application/octet-stream',
              size: typeof a.size === 'number' ? a.size : 0,
              storageId:
                typeof a.storageId === 'string' ? a.storageId : undefined,
              url: typeof a.url === 'string' ? a.url : undefined,
            }))
        : undefined;

    return {
      id: String(m._id),
      sender:
        typeof m.metadata?.sender === 'string'
          ? m.metadata.sender
          : m.direction === 'inbound'
            ? 'Customer'
            : 'Agent',
      content: m.content,
      timestamp,
      isCustomer: m.direction === 'inbound',
      status: m.deliveryState || 'sent',
      attachment,
      attachments,
    };
  });

  const metadata = conversation.metadata ?? {};

  // Fetch pending approval for this conversation
  const pendingApproval = await getPendingApprovalForResource(ctx, {
    resourceType: 'conversations',
    resourceId: conversation._id,
  });

  // Base result conforming to ConversationItem type
  // Cast needed: Doc<'conversations'> has branded Id<> types while ConversationItem expects plain strings
  const result = {
    ...conversation,
    id: conversation._id,
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
    customer_id: conversation.customerId || 'unknown',
    business_id: conversation.organizationId,
    message_count: messages.length,
    unread_count:
      typeof metadata.unread_count === 'number' ? metadata.unread_count : 0,
    last_message_at:
      messages.length > 0
        ? messages[messages.length - 1].timestamp
        : new Date(conversation._creationTime).toISOString(),
    last_read_at:
      typeof metadata.last_read_at === 'string'
        ? metadata.last_read_at
        : undefined,
    resolved_at:
      conversation.status === 'closed' &&
      typeof metadata.resolved_at === 'string'
        ? metadata.resolved_at
        : undefined,
    resolved_by:
      typeof metadata.resolved_by === 'string'
        ? metadata.resolved_by
        : undefined,
    created_at: new Date(conversation._creationTime).toISOString(),
    updated_at: new Date(conversation._creationTime).toISOString(),
    customer,
    messages,
    pendingApproval: pendingApproval || undefined,
  };

  // Doc<'conversations'> spread has branded Id<> types while ConversationItem expects plain strings
  return result as ConversationItem;
}
