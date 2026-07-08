/**
 * Transform conversation to include computed fields (business logic)
 */

import { compareConversationMessages } from '../../lib/shared/conversations/message-order';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getPendingApprovalForResource } from '../approvals/helpers';
import { createDebugLog } from '../lib/debug_log';
import type { ConversationItem, CustomerInfo, MessageInfo } from './types';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

// Server-side cap for the flat list-row preview. The ConversationList block
// cleans the HTML client-side (cleanPreviewText) and renders a single
// truncated line, so shipping more than this per row is dead weight.
const LAST_MESSAGE_PREVIEW_MAX_CHARS = 200;

export async function transformConversation(
  ctx: QueryCtx,
  conversation: Doc<'conversations'>,
  options?: {
    includeAllMessages?: boolean;
    // When a caller has batch-fetched customers for a page (see
    // get_customers_by_ids), it passes the resolved customer (or null) here to
    // avoid a per-conversation `ctx.db.get` N+1. Absent → self-fetch (default
    // for single-conversation callers).
    customer?: Doc<'customers'> | null;
  },
): Promise<ConversationItem> {
  const includeAllMessages = options?.includeAllMessages ?? false;
  const customerPrefetched = options !== undefined && 'customer' in options;
  // Only trust a prefetched customer that actually belongs to this conversation
  // (guards against a caller mapping the wrong customer); a prefetched `null` is
  // trusted as "no customer". Anything else falls back to a direct fetch.
  const prefetched = customerPrefetched
    ? (options.customer ?? null)
    : undefined;
  const prefetchUsable =
    prefetched === undefined ||
    prefetched === null ||
    prefetched._id === conversation.customerId;

  // Load customer and messages in parallel
  const [customerDoc, messageDocs] = await Promise.all([
    customerPrefetched && prefetchUsable
      ? Promise.resolve(prefetched ?? null)
      : conversation.customerId
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

  // Build customer info from fetched data. A missing name is left undefined so
  // the client can render a localized fallback (e.g. conversations.unknownCustomer)
  // instead of a hardcoded, untranslatable English string.
  let customer: CustomerInfo = {
    id: conversation.customerId || 'unknown',
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
      name: customerDoc.name || undefined,
      email: customerDoc.email || 'unknown@example.com',
      locale: typeof custMeta.locale === 'string' ? custMeta.locale : 'en',
      status: typeof custMeta.status === 'string' ? custMeta.status : 'active',
      source: typeof custMeta.source === 'string' ? custMeta.source : 'unknown',
      created_at: new Date(customerDoc._creationTime).toISOString(),
    };
  }

  // Sort chronologically by the same timestamp shown in the UI (sentAt).
  messageDocs.sort(compareConversationMessages);

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
              contentId:
                typeof a.contentId === 'string' ? a.contentId : undefined,
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
    // Flat single-level fields for the ConversationList block's item map —
    // it reads row fields one level deep, so the nested customer/message
    // data is surfaced here. `senderName` mirrors the old inbox row's
    // heading source (the customer's name; the block falls back to the
    // title client-side). `lastMessagePreview` is the latest message's RAW
    // content — the block strips HTML client-side — capped so rows stay
    // light. Both derive from data already loaded above: no extra reads.
    senderName: customer.name,
    lastMessagePreview:
      messages.length > 0
        ? messages[messages.length - 1].content.slice(
            0,
            LAST_MESSAGE_PREVIEW_MAX_CHARS,
          )
        : undefined,
  };

  // Doc<'conversations'> spread has branded Id<> types while ConversationItem expects plain strings
  return result as ConversationItem;
}
