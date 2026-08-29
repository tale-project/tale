/**
 * Transform conversation to include computed fields (business logic)
 */

import { compareConversationMessages } from '../../lib/shared/conversations/message-order';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getPendingApprovalForResource } from '../approvals/helpers';
import { createDebugLog } from '../lib/debug_log';
import type { ConversationItem, ContactInfo, MessageInfo } from './types';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

// Server-side cap for the flat list-row preview. The ConversationList block
// cleans the HTML client-side (cleanPreviewText) and renders a single
// truncated line, so shipping more than this per row is dead weight.
const LAST_MESSAGE_PREVIEW_MAX_CHARS = 200;

/**
 * How many distinct attachment blobs one conversation view will verify.
 *
 * Each is an indexed point read. A conversation long enough to exceed this is
 * rare, and the walk FAILS OPEN past the cap — nothing is marked — because
 * wrongly telling someone a file is gone is worse than leaving a link that
 * might 404.
 */
const ATTACHMENT_CHECK_CAP = 60;

/**
 * The attachment blobs that still exist, or null when there is nothing to
 * check or the cap was exceeded.
 *
 * One deduped pass before the message projection, so the projection stays
 * synchronous and a blob referenced by ten messages costs one read.
 */
async function presentAttachmentBlobs(
  ctx: QueryCtx,
  messageDocs: readonly Doc<'conversationMessages'>[],
): Promise<Set<string> | null> {
  const storageIds = new Set<string>();
  for (const m of messageDocs) {
    const raw = m.metadata?.attachments;
    if (!Array.isArray(raw)) continue;
    for (const a of raw) {
      if (!isAttachmentRecord(a)) continue;
      const storageId = a.storageId;
      if (typeof storageId === 'string' && storageId !== '') {
        storageIds.add(storageId);
      }
    }
  }
  if (storageIds.size === 0 || storageIds.size > ATTACHMENT_CHECK_CAP) {
    return null;
  }

  const present = new Set<string>();
  await Promise.all(
    [...storageIds].map(async (storageId) => {
      const row = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (row !== null) present.add(storageId);
    }),
  );
  return present;
}

/** Narrow one entry of the untyped `metadata.attachments` array. */
function isAttachmentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when the attachment names a blob the deduped pass could not find. */
function isAttachmentGone(
  a: { storageId?: string | undefined },
  presentBlobs: Set<string> | null,
): boolean {
  return (
    a.storageId !== undefined &&
    presentBlobs !== null &&
    !presentBlobs.has(a.storageId)
  );
}

export async function transformConversation(
  ctx: QueryCtx,
  conversation: Doc<'conversations'>,
  options?: {
    includeAllMessages?: boolean;
    // When a caller has batch-fetched contacts for a page (see
    // get_contacts_by_ids), it passes the resolved contact (or null) here to
    // avoid a per-conversation `ctx.db.get` N+1. Absent → self-fetch (default
    // for single-conversation callers).
    contact?: Doc<'contacts'> | null;
  },
): Promise<ConversationItem> {
  const includeAllMessages = options?.includeAllMessages ?? false;
  const contactPrefetched = options !== undefined && 'contact' in options;
  // Only trust a prefetched contact that actually belongs to this conversation
  // (guards against a caller mapping the wrong contact); a prefetched `null` is
  // trusted as "no contact". Anything else falls back to a direct fetch.
  const prefetched = contactPrefetched ? (options.contact ?? null) : undefined;
  const prefetchUsable =
    prefetched === undefined ||
    prefetched === null ||
    prefetched._id === conversation.contactId;

  // Load contact and messages in parallel. The contact (issue #2618) is the
  // sole link to the person on the conversation.
  const [contactDoc, messageDocs] = await Promise.all([
    contactPrefetched && prefetchUsable
      ? Promise.resolve(prefetched ?? null)
      : conversation.contactId
        ? ctx.db.get(conversation.contactId)
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

  // Build contact info from fetched data. A missing name is left undefined so
  // the client can render a localized fallback (e.g. conversations.unknownContact)
  // instead of a hardcoded, untranslatable English string.
  let contact: ContactInfo = {
    id: conversation.contactId ?? 'unknown',
    email: 'unknown@example.com',
    locale: 'en',
    source: 'unknown',
    created_at: new Date(conversation._creationTime).toISOString(),
  };

  if (contactDoc) {
    contact = {
      id: contactDoc._id,
      name: contactDoc.name || undefined,
      email: contactDoc.email || 'unknown@example.com',
      locale: contactDoc.locale || 'en',
      source: contactDoc.source || 'unknown',
      created_at: new Date(contactDoc._creationTime).toISOString(),
    };
  }

  // Sort chronologically by the same timestamp shown in the UI (sentAt).
  messageDocs.sort(compareConversationMessages);

  debugLog('messageDocs', messageDocs.length);
  debugLog('conversation', conversation._id);

  const presentBlobs = await presentAttachmentBlobs(ctx, messageDocs);

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
              // The stored URL outlives the bytes, so a message can offer a
              // link that 404s. Decided from live truth rather than trusted
              // from the message. The URL is withheld with it, or anything
              // holding the attachment could still offer the broken link
              // regardless of the flag.
              url: isAttachmentGone(a, presentBlobs)
                ? undefined
                : typeof a.url === 'string'
                  ? a.url
                  : undefined,
              unavailable: isAttachmentGone(a, presentBlobs) ? true : undefined,
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
      // Undo-window countdown source: only meaningful while still queued —
      // once the send fires the stamp is history, not a schedule.
      scheduledSendAt:
        m.deliveryState === 'queued' &&
        typeof m.metadata?.scheduledSendAt === 'number'
          ? m.metadata.scheduledSendAt
          : undefined,
      // Failure reason written by the send action on error.
      errorMessage:
        m.deliveryState === 'failed' && typeof m.metadata?.error === 'string'
          ? m.metadata.error
          : undefined,
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
  // Cast needed: Doc<'conversations'> has branded Id<> types while ConversationItem expects plain strings.
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
    contact_id: conversation.contactId ?? 'unknown',
    business_id: conversation.organizationId,
    message_count: messages.length,
    unread_count:
      typeof metadata.unread_count === 'number' ? metadata.unread_count : 0,
    last_message_at:
      conversation.lastMessageAt !== undefined
        ? new Date(conversation.lastMessageAt).toISOString()
        : messages.length > 0
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
    contact,
    messages,
    pendingApproval: pendingApproval || undefined,
    // Flat single-level fields for the ConversationList block's item map —
    // it reads row fields one level deep, so the nested contact/message
    // data is surfaced here. `senderName` mirrors the old inbox row's
    // heading source (the contact's name; the block falls back to the
    // title client-side). `lastMessagePreview` is the latest message's RAW
    // content — the block strips HTML client-side — capped so rows stay
    // light. Both derive from data already loaded above: no extra reads.
    senderName: contact.name,
    lastMessagePreview:
      messages.length > 0
        ? messages[messages.length - 1].content.slice(
            0,
            LAST_MESSAGE_PREVIEW_MAX_CHARS,
          )
        : undefined,
  };

  // Doc<'conversations'> spread has branded Id<> types while ConversationItem expects plain strings
  return result;
}
