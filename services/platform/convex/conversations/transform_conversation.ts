/**
 * Transform conversation to include computed fields (business logic)
 */

import { projectConversationItem } from '../../lib/shared/conversations/conversation-item';
import { compareConversationMessages } from '../../lib/shared/conversations/message-order';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { getPendingApprovalForResource } from '../approvals/helpers';
import { createDebugLog } from '../lib/debug_log';
import type { ConversationItem } from './types';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

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

  // Sort chronologically by the same timestamp shown in the UI (sentAt).
  messageDocs.sort(compareConversationMessages);

  debugLog('messageDocs', messageDocs.length);
  debugLog('conversation', conversation._id);

  const pendingApproval = await getPendingApprovalForResource(ctx, {
    resourceType: 'conversations',
    resourceId: conversation._id,
  });

  // The SHARED projection owns the shape (see
  // `lib/shared/conversations/conversation-item.ts`) so this lane and the
  // 0.5 backend cannot drift apart on what a conversation row looks like.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shared projector emits exactly this validated item shape
  const result = projectConversationItem({
    conversation: {
      ...conversation,
      id: conversation._id,
      createdAt: conversation._creationTime,
    },
    contact: contactDoc
      ? {
          id: contactDoc._id,
          name: contactDoc.name ?? null,
          email: contactDoc.email ?? null,
          locale: contactDoc.locale ?? null,
          source: contactDoc.source ?? null,
          createdAt: contactDoc._creationTime,
        }
      : null,
    messages: messageDocs.map((m) => ({
      id: String(m._id),
      direction: m.direction,
      content: m.content,
      deliveryState: m.deliveryState ?? null,
      sentAt: m.sentAt ?? null,
      metadata: m.metadata ?? null,
      createdAt: m._creationTime,
    })),
    ...(pendingApproval ? { pendingApproval } : {}),
  }) as unknown as ConversationItem;

  return result;
}
