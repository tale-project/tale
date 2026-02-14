'use node';

import { v } from 'convex/values';

import type { ConnectorConfig } from '../integrations/types';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { buildIntegrationSecrets } from '../integrations/build_test_secrets';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { getPredefinedIntegration } from '../predefined_integrations';

const DELIVERY_CHECK_DELAY_MS = 60_000;
const MAX_DELIVERY_CHECK_RETRIES = 5;

function resolveConnectorConfig(
  connector: ConnectorConfig | undefined,
  integrationName: string,
): ConnectorConfig | undefined {
  if (connector) {
    return connector;
  }
  return getPredefinedIntegration(integrationName)?.connector;
}

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
      const integration = await ctx.runQuery(
        internal.integrations.internal_queries.getByName,
        { organizationId: args.organizationId, name: args.integrationName },
      );

      if (!integration) {
        throw new Error(
          `Integration "${args.integrationName}" not found in organization "${args.organizationId}"`,
        );
      }

      const connectorConfig = resolveConnectorConfig(
        integration.connector,
        args.integrationName,
      );

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}".`,
        );
      }

      const secrets = await buildIntegrationSecrets(ctx, integration);

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

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          externalMessageId: internetMessageId,
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
      const integration = await ctx.runQuery(
        internal.integrations.internal_queries.getByName,
        { organizationId: args.organizationId, name: args.integrationName },
      );

      if (!integration) {
        console.error(
          `[checkMessageDelivery] Integration "${args.integrationName}" not found, skipping check`,
        );
        return null;
      }

      const connectorConfig = resolveConnectorConfig(
        integration.connector,
        args.integrationName,
      );

      if (!connectorConfig) {
        console.error(
          `[checkMessageDelivery] No connector config for "${args.integrationName}", skipping check`,
        );
        return null;
      }

      const secrets = await buildIntegrationSecrets(ctx, integration);

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
        await ctx.runMutation(
          internal.conversations.internal_mutations.updateConversationMessage,
          {
            messageId: args.messageId,
            deliveryState: 'delivered',
            deliveredAt: Date.now(),
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
      const integration = await ctx.runQuery(
        internal.integrations.internal_queries.getByName,
        { organizationId: args.organizationId, name: args.integrationName },
      );

      if (!integration) {
        throw new Error(
          `Integration "${args.integrationName}" not found in organization "${args.organizationId}"`,
        );
      }

      const connectorConfig = resolveConnectorConfig(
        integration.connector,
        args.integrationName,
      );

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}".`,
        );
      }

      const secrets = await buildIntegrationSecrets(ctx, integration);

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
        },
      );

      if (!result.success) {
        throw new Error(`Attachment download failed: ${result.error}`);
      }

      const fileRefs = result.fileReferences ?? [];
      if (fileRefs.length === 0) {
        return null;
      }

      const message = await ctx.runQuery(
        internal.conversations.internal_queries.getMessageById,
        { messageId: args.messageId },
      );

      if (!message) {
        throw new Error(`Message ${args.messageId} not found`);
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
      const existingMeta = (message.metadata ?? {}) as Record<string, unknown>;
      const existingAttachments = Array.isArray(existingMeta.attachments)
        ? existingMeta.attachments
        : [];

      const updatedAttachments = existingAttachments.map((att) => {
        if (typeof att !== 'object' || att === null) return att;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic metadata
        const a = att as Record<string, unknown>;
        const matchingRef = fileRefs.find(
          (ref) => ref.fileName === String(a.filename),
        );
        if (matchingRef) {
          return {
            ...a,
            storageId: matchingRef.fileId,
            url: matchingRef.url,
          };
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
