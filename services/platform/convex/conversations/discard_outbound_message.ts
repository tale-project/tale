/**
 * Discard a failed outbound message that never delivered.
 *
 * The send already fired and settled at `failed` — there is no scheduled job to
 * cancel. Deleting the row removes the bubble from the thread; the email never
 * left, so this is safe. Contrast `undoSendMessage`, which cancels a still-
 * queued send and restores the composer draft.
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { recomputeConversationLastMessageAt } from './recompute_conversation_last_message_at';

export async function discardOutboundMessage(
  ctx: MutationCtx,
  args: { messageId: Id<'conversationMessages'> },
): Promise<void> {
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throw new ConvexError({
      code: 'message_not_found',
      message: 'Message not found',
    });
  }

  if (message.direction !== 'outbound' || message.deliveryState !== 'failed') {
    throw new ConvexError({
      code: 'discard_not_available',
      message: 'Only a failed outbound message can be discarded',
    });
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;

  await ctx.db.delete(args.messageId);
  await recomputeConversationLastMessageAt(ctx, message.conversationId);

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, message.organizationId),
    action: 'discard_outbound_message',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: String(args.messageId),
    resourceName:
      typeof metadata.subject === 'string' ? metadata.subject : undefined,
    newState: {
      conversationId: String(message.conversationId),
    },
  });
}
