'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import { isRecord, getBoolean } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';

const DEFAULT_BATCH_SIZE = 100;

export const runRetentionCleanup = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const orgsWithPolicies: Array<{
      organizationId: string;
      config: RetentionPolicyConfig;
    }> = [];

    const policies = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );

    for (const policy of policies) {
      const config = policy.config;
      if (
        isRecord(config) &&
        getBoolean(config, 'enabled') &&
        typeof config['retentionDays'] === 'number'
      ) {
        orgsWithPolicies.push({
          organizationId: policy.organizationId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
          config: config as unknown as RetentionPolicyConfig,
        });
      }
    }

    for (const { organizationId, config } of orgsWithPolicies) {
      const cutoffMs = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
      const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

      const expiredDocs = await ctx.runQuery(
        internal.governance.internal_queries.listExpiredDocuments,
        {
          organizationId,
          cutoffMs,
          batchSize,
          scope: config.scope,
        },
      );

      const ragUrl = getRagConfig().serviceUrl;

      for (const doc of expiredDocs) {
        if (doc.fileId) {
          try {
            await fetch(
              `${ragUrl}/api/v1/documents/${encodeURIComponent(doc.fileId)}`,
              { method: 'DELETE', signal: AbortSignal.timeout(30000) },
            );
          } catch (error) {
            console.warn(
              `[RetentionCleanup] Failed to delete RAG entry for document ${doc._id}:`,
              error,
            );
          }
        }

        await ctx.runMutation(
          internal.governance.internal_mutations_retention
            .deleteExpiredDocument,
          { documentId: doc._id },
        );
      }
    }

    return null;
  },
});
