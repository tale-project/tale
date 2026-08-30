import { nextConversationLastMessageAt } from '../../lib/shared/conversations/message-order';
import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { emitEvent } from '../events/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

type DeliveryState = 'queued' | 'sent' | 'delivered' | 'failed';

const deliveryStateMap: Record<string, DeliveryState> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  failed: 'failed',
};

function resolveDeliveryState(
  status: string | undefined,
  direction: 'inbound' | 'outbound',
): DeliveryState {
  const normalized = (status || '').toLowerCase();
  return (
    deliveryStateMap[normalized] ??
    (direction === 'inbound' ? 'delivered' : 'sent')
  );
}

export async function addMessageToConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    organizationId: string;
    sender: string;
    content: string;
    isCustomer: boolean;
    status?: string;
    attachment?: unknown;
    attachments?: Array<{
      id: string;
      filename: string;
      contentType: string;
      size: number;
      storageId?: string;
      url?: string;
      contentId?: string;
    }>;
    externalMessageId?: string;
    metadata?: unknown;
    sentAt?: number;
    deliveredAt?: number;
    connectorName?: string;
  },
): Promise<Id<'conversations'>> {
  const parentConversation = await ctx.db.get(args.conversationId);
  if (!parentConversation) {
    throw new AppError({
      code: 'conversation_not_found',
      message: 'Parent conversation not found',
    });
  }

  if (parentConversation.organizationId !== args.organizationId) {
    throw new AppError({
      code: 'conversation_org_mismatch',
      message: 'Conversation does not belong to organization',
    });
  }

  const direction: 'inbound' | 'outbound' = args.isCustomer
    ? 'inbound'
    : 'outbound';
  const deliveryState = resolveDeliveryState(args.status, direction);

  const deliveredAt =
    args.deliveredAt ??
    (direction === 'inbound' && args.sentAt ? args.sentAt : undefined);

  const safeMetadata =
    typeof args.metadata === 'object' &&
    args.metadata !== null &&
    !Array.isArray(args.metadata)
      ? args.metadata
      : {};

  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    channel: parentConversation.channel || 'unknown',
    direction,
    externalMessageId: args.externalMessageId,
    deliveryState,
    connectorName: args.connectorName,
    content: args.content,
    sentAt: args.sentAt,
    deliveredAt,
    metadata: {
      sender: args.sender,
      isCustomer: args.isCustomer,
      ...(args.attachment ? { attachment: args.attachment } : {}),
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      ...safeMetadata,
    },
  });

  const now = Date.now();
  const lastMessageAt = nextConversationLastMessageAt(
    parentConversation.lastMessageAt,
    {
      _id: String(messageId),
      _creationTime: now,
      sentAt: args.sentAt,
      deliveredAt,
    },
  );
  const existingMetadata = parentConversation.metadata ?? {};
  // Heal a never-stamped conversation: rows without an `connectorName` are
  // invisible to the per-connector inbox apps and unreplyable — the first
  // message that names an connector stamps the row. Never overwrites an
  // existing value.
  const healConnectorName =
    !parentConversation.connectorName &&
    typeof args.connectorName === 'string' &&
    args.connectorName !== ''
      ? { connectorName: args.connectorName }
      : {};
  await ctx.db.patch(args.conversationId, {
    lastMessageAt,
    ...healConnectorName,
    metadata: {
      ...existingMetadata,
      last_message_at: lastMessageAt,
      unread_count:
        (typeof existingMetadata.unread_count === 'number'
          ? existingMetadata.unread_count
          : 0) + (args.isCustomer ? 1 : 0),
    },
  });

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, args.organizationId),
    action: 'add_message_to_conversation',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: String(messageId),
    newState: {
      conversationId: String(args.conversationId),
      direction,
      isCustomer: args.isCustomer,
      sender: args.sender,
    },
  });

  const message = await ctx.db.get(messageId);
  if (message) {
    const updatedConversation = await ctx.db.get(args.conversationId);
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'conversation.message_received',
      eventData: { conversation: updatedConversation, message },
    });
  }

  return args.conversationId;
}
