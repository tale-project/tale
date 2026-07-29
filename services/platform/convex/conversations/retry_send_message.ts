/**
 * Re-attempt delivery of a failed outbound message.
 *
 * The send action (`sendMessageViaConnectorAction`) settles a message at
 * `failed` with `metadata.error` when the provider send throws (e.g. SMTP
 * connect timeout). This helper rebuilds the action's args from the stored
 * row — the original recipients, subject, and threading headers live in the
 * message metadata, the body is the row's `content` — flips the row back to
 * `queued`, and schedules the action immediately (no undo window on a retry:
 * the user just asked for the send).
 */

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { inboundRecipientAddress } from './reply_from';

function asStringArray(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => {
    return typeof item === 'string';
  });
  return strings.length > 0 ? strings : undefined;
}

/** Rebuild the action's attachment args from the metadata stamped at send. */
function attachmentsFromMetadata(value: unknown):
  | Array<{
      storageId: Id<'_storage'>;
      fileName: string;
      contentType: string;
      size?: number;
    }>
  | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments: Array<{
    storageId: Id<'_storage'>;
    fileName: string;
    contentType: string;
    size?: number;
  }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.storageId !== 'string' ||
      typeof entry.filename !== 'string' ||
      typeof entry.contentType !== 'string'
    ) {
      continue;
    }
    attachments.push({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stamped as an Id<'_storage'> by sendMessageViaConnector
      storageId: entry.storageId as Id<'_storage'>,
      fileName: entry.filename,
      contentType: entry.contentType,
      ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    });
  }
  return attachments.length > 0 ? attachments : undefined;
}

export async function retrySendMessage(
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
      code: 'retry_not_available',
      message: 'Only a failed outbound message can be retried',
    });
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const to = asStringArray(metadata.to);
  const connectorName =
    message.connectorName ??
    (typeof metadata.connectorName === 'string'
      ? metadata.connectorName
      : undefined);
  if (!to || !connectorName) {
    // Rows written before the composer stamped its send args can't be rebuilt.
    throw new ConvexError({
      code: 'retry_not_available',
      message: 'This message is missing its original send parameters',
    });
  }

  const subject = typeof metadata.subject === 'string' ? metadata.subject : '';

  const conversation = await ctx.db.get(message.conversationId);
  const replyFrom = inboundRecipientAddress(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
    conversation?.metadata as Record<string, unknown> | undefined,
  );

  // Clear the failure and the stale undo stamps: a retry is immediate, so
  // there is no scheduled window to count down or cancel.
  const retainedMetadata = { ...metadata };
  delete retainedMetadata.error;
  delete retainedMetadata.scheduledSendId;
  delete retainedMetadata.scheduledSendAt;
  await ctx.db.patch(args.messageId, {
    deliveryState: 'queued',
    retryCount: (message.retryCount ?? 0) + 1,
    metadata: retainedMetadata,
  });

  const attachments = attachmentsFromMetadata(metadata.attachments);
  await ctx.scheduler.runAfter(
    0,
    internal.conversations.internal_actions.sendMessageViaConnectorAction,
    {
      messageId: args.messageId,
      organizationId: message.organizationId,
      connectorName,
      to,
      cc: asStringArray(metadata.cc),
      subject,
      body: message.content,
      contentType:
        typeof metadata.sendContentType === 'string'
          ? metadata.sendContentType
          : 'HTML',
      inReplyTo:
        typeof metadata.inReplyTo === 'string' ? metadata.inReplyTo : undefined,
      references: asStringArray(metadata.references),
      ...(replyFrom ? { from: replyFrom } : {}),
      ...(attachments ? { attachments } : {}),
    },
  );

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, message.organizationId),
    action: 'retry_send_message',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: String(args.messageId),
    resourceName: subject || undefined,
    newState: {
      conversationId: String(message.conversationId),
      connectorName,
      to,
      retryCount: (message.retryCount ?? 0) + 1,
    },
  });
}
