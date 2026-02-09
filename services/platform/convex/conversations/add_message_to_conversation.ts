import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { emitEvent } from '../workflows/triggers/emit_event';

type DeliveryState = 'queued' | 'sent' | 'delivered' | 'failed';

const VALID_DELIVERY_STATES = new Set<string>([
  'queued',
  'sent',
  'delivered',
  'failed',
]);

function resolveDeliveryState(
  status: string | undefined,
  direction: 'inbound' | 'outbound',
): DeliveryState {
  const normalized = (status || '').toLowerCase();
  if (VALID_DELIVERY_STATES.has(normalized)) {
    return normalized as DeliveryState;
  }
  return direction === 'inbound' ? 'delivered' : 'sent';
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
    providerId?: Id<'emailProviders'>;
    externalMessageId?: string;
    metadata?: unknown;
    sentAt?: number;
    deliveredAt?: number;
  },
): Promise<Id<'conversations'>> {
  const parentConversation = await ctx.db.get(args.conversationId);
  if (!parentConversation) {
    throw new Error('Parent conversation not found');
  }

  if (parentConversation.organizationId !== args.organizationId) {
    throw new Error('Conversation does not belong to organization');
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
    providerId: args.providerId || parentConversation.providerId,
    channel: parentConversation.channel || 'unknown',
    direction,
    externalMessageId: args.externalMessageId,
    deliveryState,
    content: args.content,
    sentAt: args.sentAt,
    deliveredAt,
    metadata: {
      sender: args.sender,
      isCustomer: args.isCustomer,
      ...(args.attachment ? { attachment: args.attachment } : {}),
      ...safeMetadata,
    },
  });

  if (args.providerId && !parentConversation.providerId) {
    await ctx.db.patch(args.conversationId, {
      providerId: args.providerId,
    });
  }

  const now = Date.now();
  const existingMetadata = parentConversation.metadata ?? {};
  await ctx.db.patch(args.conversationId, {
    lastMessageAt: now,
    metadata: {
      ...existingMetadata,
      last_message_at: now,
      unread_count:
        (typeof existingMetadata.unread_count === 'number'
          ? existingMetadata.unread_count
          : 0) + (args.isCustomer ? 1 : 0),
    },
  });

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, args.organizationId),
    'add_message_to_conversation',
    'data',
    'conversationMessage',
    String(messageId),
    undefined,
    undefined,
    {
      conversationId: String(args.conversationId),
      direction,
      isCustomer: args.isCustomer,
      sender: args.sender,
    },
  );

  await emitEvent(ctx, {
    organizationId: args.organizationId,
    eventType: 'conversation.message_received',
    eventData: {
      conversationId: args.conversationId,
      messageId,
      direction,
      isCustomer: args.isCustomer,
      sender: args.sender,
    },
  });

  return args.conversationId;
}
