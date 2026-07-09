'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { buildIntegrationSecrets } from '../integrations/build_test_secrets';
import { isImapSmtpIntegration } from '../integrations/guards/is_imap_smtp_integration';
import { resolveImapSmtpConnection } from '../integrations/imap_smtp_config';
import { shouldSaveSentToImap } from '../integrations/should_save_sent_to_imap';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { normalizeExternalMessageId } from '../workflow_engine/action_defs/conversation/helpers/normalize_external_message_id';
import { resolveReplyFrom } from './reply_from';
const DELIVERY_CHECK_DELAY_MS = 60_000;
const MAX_DELIVERY_CHECK_RETRIES = 5;

export const sendMessageViaIntegrationAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    integrationName: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    contentType: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    // The address the customer originally wrote to (multi-address support):
    // reply as that address when it's on the sender's domain (imap_smtp only).
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
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const integration = await ctx.runAction(
        internal.integrations.load_integration.loadIntegration,
        {
          orgSlug,
          organizationId: args.organizationId,
          slug: args.integrationName,
        },
      );

      if (!integration) {
        throw new Error(
          `Integration "${args.integrationName}" not found in organization "${args.organizationId}"`,
        );
      }

      // IMAP/SMTP mailbox integrations send via the Node SMTP action
      // (nodemailer), not the HTTP-only connector sandbox.
      if (isImapSmtpIntegration(integration)) {
        const connection = await resolveImapSmtpConnection(ctx, integration);

        // From resolution (multi-address): default to the configured From
        // (connectionConfig.fromAddress) or the SMTP login, then prefer the
        // address the customer actually wrote to (args.from) when it shares the
        // sender's domain — so one mailbox replies as support@, billing@, etc.
        // The domain guard avoids an unverified From the provider (e.g. Resend)
        // would reject.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectionConfig is v.any() with mailbox-specific keys
        const connConfig = integration.connectionConfig as
          | Record<string, unknown>
          | undefined;
        const fallbackFrom =
          typeof connConfig?.fromAddress === 'string' &&
          connConfig.fromAddress.trim() !== ''
            ? connConfig.fromAddress.trim()
            : connection.smtp.user;
        const from = resolveReplyFrom(args.from, fallbackFrom);

        // The conversation body is HTML unless the caller marks it text.
        const isHtml = (args.contentType ?? 'HTML')
          .toLowerCase()
          .includes('html');

        const smtpAttachments = args.attachments
          ? await Promise.all(
              args.attachments.map(async (att) => {
                const url = await ctx.storage.getUrl(att.storageId);
                if (!url) {
                  throw new Error(`Attachment URL not found: ${att.storageId}`);
                }
                return {
                  filename: att.fileName,
                  contentType: att.contentType,
                  url,
                };
              }),
            )
          : undefined;

        const sendResult = await ctx.runAction(
          internal.node_only.imap_smtp.internal_actions.sendMessage,
          {
            smtp: connection.smtp,
            from,
            to: args.to,
            cc: args.cc,
            subject: args.subject,
            text: isHtml ? undefined : args.body,
            html: isHtml ? args.body : undefined,
            inReplyTo: args.inReplyTo,
            references: args.references,
            attachments: smtpAttachments,
          },
        );

        if (!sendResult.success) {
          throw new Error(`SMTP send failed: ${sendResult.error}`);
        }

        if (shouldSaveSentToImap(connConfig)) {
          const appendResult = await ctx.runAction(
            internal.node_only.imap_smtp.internal_actions.appendSentMessage,
            {
              imap: connection.imap,
              from,
              to: args.to,
              cc: args.cc,
              subject: args.subject,
              text: isHtml ? undefined : args.body,
              html: isHtml ? args.body : undefined,
              messageId: sendResult.messageId,
              inReplyTo: args.inReplyTo,
              references: args.references,
              attachments: smtpAttachments,
              sentMailbox:
                typeof connConfig?.sentMailbox === 'string'
                  ? connConfig.sentMailbox
                  : undefined,
            },
          );

          if (!appendResult.success) {
            console.warn(
              `[sendMessageViaIntegration] IMAP Sent append failed (send succeeded): ${appendResult.error ?? 'unknown error'}`,
            );
          }
        }

        // SMTP acceptance is the strongest signal available (no mailbox
        // read-back like the Gmail delivery check), so settle at 'sent'.
        await ctx.runMutation(
          internal.conversations.internal_mutations.updateConversationMessage,
          {
            messageId: args.messageId,
            // Store the canonical (bracket-stripped) Message-ID so the sent-folder
            // sync's dedup lookup (which normalizes on read) matches this row and
            // does not re-insert the Tale-sent copy.
            externalMessageId: normalizeExternalMessageId(sendResult.messageId),
            deliveryState: 'sent',
            sentAt: Date.now(),
          },
        );

        return null;
      }

      const connectorConfig = integration.connector;

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}".`,
        );
      }

      const secrets = await buildIntegrationSecrets(
        ctx,
        {
          ...integration,
          secretBindings: integration.connector?.secretBindings,
        },
        integration._id,
      );

      const opParams: Record<string, unknown> = {
        to: args.to,
        subject: args.subject,
        body: args.body,
        contentType: args.contentType || 'HTML',
      };

      if (args.cc && args.cc.length > 0) {
        opParams.cc = args.cc;
      }

      if (args.inReplyTo) {
        opParams.inReplyTo = args.inReplyTo;
      }

      if (args.references && args.references.length > 0) {
        opParams.references = args.references;
      }

      const extraAllowedHosts: string[] = [];

      if (args.attachments && args.attachments.length > 0) {
        const attachmentData = await Promise.all(
          args.attachments.map(async (att) => {
            const url = await ctx.storage.getUrl(att.storageId);
            if (!url)
              throw new Error(`Attachment URL not found: ${att.storageId}`);
            return {
              name: att.fileName,
              contentType: att.contentType,
              size: att.size ?? 0,
              url,
            };
          }),
        );
        opParams.attachments = attachmentData;

        // Whitelist the Convex storage host so the connector can download files
        const storageHost = new URL(attachmentData[0].url).hostname;
        extraAllowedHosts.push(storageHost);
      }

      const result = await ctx.runAction(
        internal.node_only.integration_sandbox.internal_actions
          .executeIntegration,
        {
          code: connectorConfig.code,
          operation: 'send_message',
          params: toConvexJsonRecord(opParams),
          variables: {},
          secrets,
          allowedHosts: [
            ...(connectorConfig.allowedHosts ?? []),
            ...extraAllowedHosts,
          ],
          timeoutMs: connectorConfig.timeoutMs ?? 30000,
          organizationId: args.organizationId,
        },
      );

      if (!result.success) {
        throw new Error(`Integration send failed: ${result.error}`);
      }

      // Extract internetMessageId returned by the connector (draft→send pattern)
      const resultData =
        result.result &&
        typeof result.result === 'object' &&
        'data' in result.result
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic connector result
            (result.result.data as Record<string, unknown>)
          : undefined;

      const internetMessageId =
        resultData && typeof resultData.internetMessageId === 'string'
          ? resultData.internetMessageId
          : undefined;

      // Prefer the Gmail internal hex ID for externalMessageId — this is the
      // same format used by the connector during sync (msg.id), ensuring
      // deduplication works when sent messages are later fetched by sync.
      const gmailMessageId =
        args.integrationName === 'gmail' &&
        resultData &&
        typeof resultData.id === 'string'
          ? resultData.id
          : undefined;

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          externalMessageId: gmailMessageId ?? internetMessageId,
          deliveryState: 'sent',
          sentAt: Date.now(),
        },
      );

      // Schedule a delivery check after 60 seconds to confirm the message
      // actually appeared in the mailbox (sent → delivered).
      if (internetMessageId) {
        await ctx.scheduler.runAfter(
          DELIVERY_CHECK_DELAY_MS,
          internal.conversations.internal_actions.checkMessageDeliveryAction,
          {
            messageId: args.messageId,
            organizationId: args.organizationId,
            integrationName: args.integrationName,
            internetMessageId,
          },
        );
      }
    } catch (error) {
      console.error(
        '[sendMessageViaIntegrationAction] error:',
        error instanceof Error ? error.message : error,
      );

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          deliveryState: 'failed',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      );
    }

    return null;
  },
});

export const checkMessageDeliveryAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    integrationName: v.string(),
    internetMessageId: v.string(),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const retryCount = args.retryCount ?? 0;

    try {
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const integration = await ctx.runAction(
        internal.integrations.load_integration.loadIntegration,
        {
          orgSlug,
          organizationId: args.organizationId,
          slug: args.integrationName,
        },
      );

      if (!integration) {
        console.error(
          `[checkMessageDelivery] Integration "${args.integrationName}" not found, skipping check`,
        );
        return null;
      }

      const connectorConfig = integration.connector;

      if (!connectorConfig) {
        console.error(
          `[checkMessageDelivery] No connector config for "${args.integrationName}", skipping check`,
        );
        return null;
      }

      const secrets = await buildIntegrationSecrets(
        ctx,
        {
          ...integration,
          secretBindings: integration.connector?.secretBindings,
        },
        integration._id,
      );

      const result = await ctx.runAction(
        internal.node_only.integration_sandbox.internal_actions
          .executeIntegration,
        {
          code: connectorConfig.code,
          operation: 'check_delivery',
          params: toConvexJsonRecord({
            internetMessageId: args.internetMessageId,
          }),
          variables: {},
          secrets,
          allowedHosts: connectorConfig.allowedHosts ?? [],
          timeoutMs: connectorConfig.timeoutMs ?? 30000,
          organizationId: args.organizationId,
        },
      );

      if (!result.success) {
        console.error(
          `[checkMessageDelivery] check_delivery failed: ${result.error}`,
        );

        if (retryCount < MAX_DELIVERY_CHECK_RETRIES) {
          const delay = DELIVERY_CHECK_DELAY_MS * Math.pow(2, retryCount);
          await ctx.scheduler.runAfter(
            delay,
            internal.conversations.internal_actions.checkMessageDeliveryAction,
            {
              messageId: args.messageId,
              organizationId: args.organizationId,
              integrationName: args.integrationName,
              internetMessageId: args.internetMessageId,
              retryCount: retryCount + 1,
            },
          );
        }

        return null;
      }

      const resultData =
        result.result &&
        typeof result.result === 'object' &&
        'data' in result.result
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic connector result
            (result.result.data as Record<string, unknown>)
          : undefined;

      if (resultData?.delivered === true) {
        const message = await ctx.runQuery(
          internal.conversations.internal_queries.getMessageById,
          { messageId: args.messageId, organizationId: args.organizationId },
        );

        await ctx.runMutation(
          internal.conversations.internal_mutations.updateConversationMessage,
          {
            messageId: args.messageId,
            deliveryState: 'delivered',
            deliveredAt: message?.sentAt ?? Date.now(),
          },
        );
        return null;
      }

      // Not yet delivered — retry with exponential backoff
      if (retryCount < MAX_DELIVERY_CHECK_RETRIES) {
        const delay = DELIVERY_CHECK_DELAY_MS * Math.pow(2, retryCount);
        await ctx.scheduler.runAfter(
          delay,
          internal.conversations.internal_actions.checkMessageDeliveryAction,
          {
            messageId: args.messageId,
            organizationId: args.organizationId,
            integrationName: args.integrationName,
            internetMessageId: args.internetMessageId,
            retryCount: retryCount + 1,
          },
        );
      } else {
        console.warn(
          `[checkMessageDelivery] Message ${args.internetMessageId} not confirmed after ${MAX_DELIVERY_CHECK_RETRIES} retries`,
        );
      }
    } catch (error) {
      console.error(
        '[checkMessageDelivery] error:',
        error instanceof Error ? error.message : error,
      );
    }

    return null;
  },
});

export const downloadAttachmentsAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    integrationName: v.string(),
    externalMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const integration = await ctx.runAction(
        internal.integrations.load_integration.loadIntegration,
        {
          orgSlug,
          organizationId: args.organizationId,
          slug: args.integrationName,
        },
      );

      if (!integration) {
        throw new Error(
          `Integration "${args.integrationName}" not found in organization "${args.organizationId}"`,
        );
      }

      const connectorConfig = integration.connector;

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}".`,
        );
      }

      const secrets = await buildIntegrationSecrets(
        ctx,
        {
          ...integration,
          secretBindings: integration.connector?.secretBindings,
        },
        integration._id,
      );

      const result = await ctx.runAction(
        internal.node_only.integration_sandbox.internal_actions
          .executeIntegration,
        {
          code: connectorConfig.code,
          operation: 'get_attachments',
          params: toConvexJsonRecord({
            messageId: args.externalMessageId,
          }),
          variables: {},
          secrets,
          allowedHosts: connectorConfig.allowedHosts ?? [],
          timeoutMs: connectorConfig.timeoutMs ?? 30000,
          organizationId: args.organizationId,
        },
      );

      if (!result.success) {
        throw new Error(`Attachment download failed: ${result.error}`);
      }

      const fileRefs = result.fileReferences ?? [];
      if (fileRefs.length === 0) {
        return null;
      }

      // Build an index-based contentId lookup from the connector's return data.
      // fileReferences and result.data are produced in the same loop order by
      // the connector, so we correlate by array index rather than filename
      // (filenames can be duplicated, e.g. multiple "image.png").
      const connectorData =
        result.result &&
        typeof result.result === 'object' &&
        'data' in result.result &&
        Array.isArray(result.result.data)
          ? result.result.data
          : [];

      function getContentIdForRef(refIndex: number): string | undefined {
        const item = connectorData[refIndex];
        if (
          typeof item === 'object' &&
          item !== null &&
          'contentId' in item &&
          typeof item.contentId === 'string'
        ) {
          return item.contentId;
        }
        return undefined;
      }

      const message = await ctx.runQuery(
        internal.conversations.internal_queries.getMessageById,
        { messageId: args.messageId, organizationId: args.organizationId },
      );

      if (!message) {
        throw new Error(`Message ${args.messageId} not found`);
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
      const existingMeta = (message.metadata ?? {}) as Record<string, unknown>;
      const existingAttachments = Array.isArray(existingMeta.attachments)
        ? existingMeta.attachments
        : [];

      // Track which fileRefs have been consumed so duplicate filenames get
      // matched to distinct refs in order.
      const usedRefIndices = new Set<number>();
      const updatedAttachments = existingAttachments.map((att) => {
        if (typeof att !== 'object' || att === null) return att;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic metadata
        const a = att as Record<string, unknown>;
        const matchIdx = fileRefs.findIndex(
          (ref, idx) =>
            !usedRefIndices.has(idx) && ref.fileName === String(a.filename),
        );
        if (matchIdx !== -1) {
          const matchingRef = fileRefs[matchIdx];
          usedRefIndices.add(matchIdx);
          const contentId = getContentIdForRef(matchIdx);
          const updated = Object.assign({}, a, {
            storageId: matchingRef.fileId,
            url: matchingRef.url,
          });
          if (contentId && !a.contentId) {
            updated.contentId = contentId;
          }
          return updated;
        }
        return att;
      });

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          metadata: {
            ...existingMeta,
            attachments: updatedAttachments,
          },
        },
      );
    } catch (error) {
      console.error(
        '[downloadAttachmentsAction] error:',
        error instanceof Error ? error.message : error,
      );
    }

    return null;
  },
});
