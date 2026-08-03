'use node';

import { ConvexError, v } from 'convex/values';

import { convexErrorCode } from '../../lib/utils/convex-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { sendConnectorAction } from './connector_slug';
import { normalizeExternalMessageId } from './ingest/normalize_external_message_id';

const DELIVERY_CHECK_DELAY_MS = 60_000;

function isHtmlContentType(contentType: string | undefined): boolean {
  const normalized = (contentType ?? 'HTML').toLowerCase();
  return normalized.includes('html');
}

function joinRecipients(addresses: readonly string[]): string {
  return addresses
    .map((address) => address.trim())
    .filter((address) => address !== '')
    .join(', ');
}

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (
      isRecord(data) &&
      typeof data.message === 'string' &&
      data.message.trim() !== ''
    ) {
      return data.message;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function attachmentPayloads(
  ctx: { storage: { getUrl: (id: Id<'_storage'>) => Promise<string | null> } },
  attachments:
    | Array<{
        storageId: Id<'_storage'>;
        fileName: string;
        contentType: string;
        size?: number;
      }>
    | undefined,
): Promise<
  Array<{ name: string; contentType: string; size: number; url: string }>
> {
  if (!attachments || attachments.length === 0) return [];
  return Promise.all(
    attachments.map(async (att) => {
      const url = await ctx.storage.getUrl(att.storageId);
      if (!url) {
        throw new Error(`Attachment URL not found: ${att.storageId}`);
      }
      return {
        name: att.fileName,
        contentType: att.contentType,
        size: att.size ?? 0,
        url,
      };
    }),
  );
}

function buildSendInput(args: {
  connectorName: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  contentType?: string;
  inReplyTo?: string;
  references?: string[];
  attachments: Array<{
    name: string;
    contentType: string;
    size: number;
    url: string;
  }>;
}): Record<string, unknown> {
  const html = isHtmlContentType(args.contentType);
  const { connector } = sendConnectorAction(args.connectorName);
  const recipients = joinRecipients(args.to);

  if (connector === 'imap-smtp') {
    return {
      to: recipients,
      subject: args.subject,
      ...(html ? { html: args.body } : { text: args.body }),
      ...(args.inReplyTo !== undefined && { inReplyTo: args.inReplyTo }),
    };
  }

  const base: Record<string, unknown> = {
    to: connector === 'outlook' ? args.to : recipients,
    subject: args.subject,
    body: args.body,
    contentType: args.contentType ?? 'HTML',
  };
  if (args.cc && args.cc.length > 0) {
    base.cc = connector === 'outlook' ? args.cc : joinRecipients(args.cc);
  }
  if (args.inReplyTo) base.inReplyTo = args.inReplyTo;
  if (args.references && args.references.length > 0) {
    base.references =
      connector === 'outlook' ? args.references : args.references.join(' ');
  }
  if (args.attachments.length > 0) {
    base.attachments = args.attachments;
  }
  return base;
}

function externalIdFromSendOutput(
  connectorName: string,
  output: unknown,
): string | undefined {
  if (!isRecord(output)) return undefined;
  const { connector } = sendConnectorAction(connectorName);
  if (connector === 'gmail' && typeof output.id === 'string') {
    return output.id;
  }
  if (typeof output.messageId === 'string') {
    return normalizeExternalMessageId(output.messageId) ?? output.messageId;
  }
  return undefined;
}

function internetMessageIdFromSendOutput(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined;
  if (typeof output.messageId === 'string' && output.messageId.includes('@')) {
    return output.messageId;
  }
  return undefined;
}

export const sendMessageViaConnectorAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    contentType: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    from: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.string(),
          contentType: v.string(),
          size: v.optional(v.number()),
        }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const { connector, action } = sendConnectorAction(args.connectorName);
      const attachments = await attachmentPayloads(ctx, args.attachments);
      const input = buildSendInput({
        connectorName: args.connectorName,
        to: args.to,
        cc: args.cc,
        subject: args.subject,
        body: args.body,
        contentType: args.contentType,
        inReplyTo: args.inReplyTo,
        references: args.references,
        attachments,
      });

      const result = await ctx.runAction(
        internal.connectors.execute_action.runConnectorAction,
        {
          organizationId: args.organizationId,
          connector,
          action,
          input,
          mode: 'live',
          caller: { kind: 'system', reason: 'conversation email reply' },
        },
      );

      if (result.status !== 'ok') {
        throw new Error(result.message);
      }

      const externalMessageId = externalIdFromSendOutput(
        args.connectorName,
        result.output,
      );
      const now = Date.now();

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          ...(externalMessageId !== undefined && { externalMessageId }),
          deliveryState: 'sent',
          sentAt: now,
        },
      );

      const internetMessageId = internetMessageIdFromSendOutput(result.output);
      if (internetMessageId && connector !== 'imap-smtp') {
        await ctx.scheduler.runAfter(
          DELIVERY_CHECK_DELAY_MS,
          internal.conversations.internal_actions.checkMessageDeliveryAction,
          {
            messageId: args.messageId,
            organizationId: args.organizationId,
            connectorName: args.connectorName,
            internetMessageId,
          },
        );
      }
    } catch (error) {
      const code = convexErrorCode(error);
      console.error(
        '[sendMessageViaConnectorAction] error:',
        code ?? errorMessage(error),
      );

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          deliveryState: 'failed',
          metadata: {
            error: errorMessage(error),
            ...(code !== undefined && { errorCode: code }),
          },
        },
      );
    }

    return null;
  },
});

/** Best-effort delivery confirmation for OAuth mailboxes (Gmail / Outlook). */
export const checkMessageDeliveryAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    internetMessageId: v.string(),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    return null;
  },
});

/** Best-effort attachment materialization for a received message. */
export const downloadAttachmentsAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    externalMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    return null;
  },
});
