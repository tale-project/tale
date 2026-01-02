/**
 * Transform conversation to include computed fields (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { ConversationItem, CustomerInfo, MessageInfo } from './types';
import { getPendingApprovalForResource } from '../approvals/get_approval_history';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

export async function transformConversation(
  ctx: QueryCtx,
  conversation: Doc<'conversations'>,
): Promise<ConversationItem> {
  // Get customer data if customerId exists
  let customer: CustomerInfo = {
    id: conversation.customerId || 'unknown',
    name: 'Unknown Customer',
    email: 'unknown@example.com',
    locale: 'en',
    status: 'active',
    source: 'unknown',
    created_at: new Date(conversation._creationTime).toISOString(),
  };

  if (conversation.customerId) {
    const customerDoc = await ctx.db.get(conversation.customerId);
    if (customerDoc) {
      const customerStatus =
        (customerDoc.metadata as { status?: string })?.status || 'active';
      customer = {
        id: customerDoc._id,
        name: customerDoc.name || 'Unknown Customer',
        email: customerDoc.email || 'unknown@example.com',
        locale: (customerDoc.metadata as { locale?: string })?.locale || 'en',
        status: customerStatus,
        source:
          (customerDoc.metadata as { source?: string })?.source || 'unknown',
        created_at: new Date(customerDoc._creationTime).toISOString(),
      };
    }
  }

  // Load messages for this conversation from conversationMessages
  // We need to handle null deliveredAt values properly - they should come last
  const messageDocs: Array<Doc<'conversationMessages'>> = [];
  for await (const msg of ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversation._id),
    )) {
    messageDocs.push(msg);
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

    return {
      id: m._id,
      sender:
        (m.metadata as { sender?: string })?.sender ||
        (m.direction === 'inbound' ? 'Customer' : 'Agent'),
      content: m.content,
      timestamp,
      isCustomer: m.direction === 'inbound',
      status: (m.deliveryState as 'queued' | 'sent' | 'delivered' | 'failed') || 'sent',
      attachment: (m.metadata as { attachment?: unknown })?.attachment,
    };
  });

  const metadata = (conversation.metadata as Record<string, unknown>) || {};

  // Fetch pending approval for this conversation
  const pendingApproval = await getPendingApprovalForResource(ctx, {
    resourceType: 'conversations' as const,
    resourceId: conversation._id,
  });

  return {
    ...conversation,
    id: conversation._id,
    title: conversation.subject || 'Untitled Conversation',
    description:
      (metadata.description as string) ||
      conversation.subject ||
      'No description',
    channel: conversation.channel || (metadata.channel as string) || 'Email',
    type: conversation.type || 'General',
    customer_id: conversation.customerId || 'unknown',
    business_id: conversation.organizationId,
    message_count: messages.length,
    unread_count: (metadata.unread_count as number) || 0,
    last_message_at:
      messages.length > 0
        ? messages[messages.length - 1].timestamp
        : new Date(conversation._creationTime).toISOString(),
    last_read_at: metadata.last_read_at as string | undefined,
    resolved_at:
      conversation.status === 'closed'
        ? (metadata.resolved_at as string | undefined)
        : undefined,
    resolved_by: metadata.resolved_by as string | undefined,
    created_at: new Date(conversation._creationTime).toISOString(),
    updated_at: new Date(conversation._creationTime).toISOString(),
    customer,
    messages,
    pendingApproval: pendingApproval || undefined,
  };
}
