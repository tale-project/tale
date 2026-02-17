import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import {
  hasMessageListOperation,
  hasThreadOperation,
  inferChannel,
  provisionConversationSyncWorkflow,
} from './provision_conversation_sync_workflow';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export const provisionConversationSync = internalAction({
  args: {
    organizationId: v.string(),
    integrationId: v.id('integrations'),
    integrationName: v.string(),
    integrationTitle: v.string(),
    channel: v.string(),
    hasGetThread: v.boolean(),
    syncFrequency: v.string(),
    accountEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await provisionConversationSyncWorkflow(ctx, args);
  },
});

/**
 * Backfill conversation sync workflows for existing integrations
 * that have messaging capabilities but no sync workflow yet.
 *
 * Run via Convex dashboard or CLI:
 *   npx convex run integrations/internal_actions:backfillConversationSync '{"organizationId": "..."}'
 */
export const backfillConversationSync = internalAction({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const integrations = await ctx.runQuery(
      internal.integrations.internal_queries.listInternal,
      { organizationId: args.organizationId },
    );

    let provisioned = 0;
    let skipped = 0;

    for (const integration of integrations) {
      const metadata = isRecord(integration.metadata)
        ? integration.metadata
        : {};

      // Skip if already has a conversation sync workflow
      if (metadata.conversationSyncWorkflowId) {
        debugLog(
          `Skipping ${integration.name}: already has conversation sync workflow`,
        );
        skipped++;
        continue;
      }

      // Skip if no connector operations or no message listing capability.
      // For backfill, we infer sync capability from the operations themselves
      // since older integrations may not have `capabilities.canSync` set.
      const operations = integration.connector?.operations;
      if (!operations || !hasMessageListOperation(operations)) {
        debugLog(`Skipping ${integration.name}: no message listing operations`);
        skipped++;
        continue;
      }

      debugLog(`Provisioning conversation sync for ${integration.name}`);

      await provisionConversationSyncWorkflow(ctx, {
        organizationId: args.organizationId,
        integrationId: integration._id,
        integrationName: integration.name,
        integrationTitle: integration.title,
        channel: inferChannel(integration.name),
        hasGetThread: hasThreadOperation(operations),
        syncFrequency: integration.capabilities?.syncFrequency ?? '5m',
      });

      provisioned++;
    }

    debugLog(
      `Backfill complete: ${provisioned} provisioned, ${skipped} skipped`,
    );

    return { provisioned, skipped };
  },
});
