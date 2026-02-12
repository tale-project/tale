'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { buildIntegrationSecrets } from '../integrations/build_test_secrets';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { getPredefinedIntegration } from '../predefined_integrations';

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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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

      let connectorConfig = integration.connector;
      if (!connectorConfig) {
        const predefined = getPredefinedIntegration(args.integrationName);
        if (predefined) {
          connectorConfig = predefined.connector;
        }
      }

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

      const result = await ctx.runAction(
        internal.node_only.integration_sandbox.internal_actions
          .executeIntegration,
        {
          code: connectorConfig.code,
          operation: 'send_message',
          params: toConvexJsonRecord(opParams),
          variables: {},
          secrets,
          allowedHosts: connectorConfig.allowedHosts ?? [],
          timeoutMs: connectorConfig.timeoutMs ?? 30000,
        },
      );

      if (!result.success) {
        throw new Error(`Integration send failed: ${result.error}`);
      }

      await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversationMessage,
        {
          messageId: args.messageId,
          deliveryState: 'sent',
          sentAt: Date.now(),
        },
      );
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
