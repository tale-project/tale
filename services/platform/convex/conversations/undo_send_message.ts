/**
 * Cancel an outbound send inside its undo window.
 *
 * `sendMessageViaConnector` schedules the actual delivery UNDO_SEND_DELAY_MS
 * in the future and stamps the scheduled-function id on the message row. While
 * the row is still `queued` this helper cancels that job, deletes the row (the
 * email never existed), walks the conversation's `lastMessageAt` back to the
 * remaining latest message, and returns the composer's `sourceMarkdown` so the
 * caller can restore the draft.
 *
 * Once the action has fired the row is `sent`/`failed` and undo is rejected —
 * `scheduler.cancel` alone would be a silent no-op on a job that already ran,
 * so the delivery state is the guard. Documented v1 edge: an approval
 * completed by the send stays completed after an undo.
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { recomputeConversationLastMessageAt } from './recompute_conversation_last_message_at';

export interface UndoSendMessageResult {
  /** The composer's markdown at send time, for draft restore. */
  sourceMarkdown: string | null;
}

export async function undoSendMessage(
  ctx: MutationCtx,
  args: { messageId: Id<'conversationMessages'> },
): Promise<UndoSendMessageResult> {
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throw new ConvexError({
      code: 'message_not_found',
      message: 'Message not found',
    });
  }

  if (message.direction !== 'outbound' || message.deliveryState !== 'queued') {
    throw new ConvexError({
      code: 'undo_window_closed',
      message: 'The message has already been sent',
    });
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const scheduledSendId = metadata.scheduledSendId;
  if (typeof scheduledSendId !== 'string' || !scheduledSendId) {
    // Pre-feature rows (or non-composer writers) have no cancellable job.
    throw new ConvexError({
      code: 'undo_not_available',
      message: 'This message cannot be unsent',
    });
  }

  await ctx.scheduler.cancel(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored as String(Id<'_scheduled_functions'>) by sendMessageViaConnector
    scheduledSendId as Id<'_scheduled_functions'>,
  );

  await ctx.db.delete(args.messageId);
  await recomputeConversationLastMessageAt(ctx, message.conversationId);

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, message.organizationId),
    action: 'undo_send_message',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: String(args.messageId),
    resourceName:
      typeof metadata.subject === 'string' ? metadata.subject : undefined,
    newState: {
      conversationId: String(message.conversationId),
      cancelledScheduledSendId: scheduledSendId,
    },
  });

  const sourceMarkdown = metadata.sourceMarkdown;
  return {
    sourceMarkdown: typeof sourceMarkdown === 'string' ? sourceMarkdown : null,
  };
}
