'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_TEMP_RETENTION_HOURS = 24;

function parseConfig(config: unknown): RetentionPolicyConfig | null {
  if (!isRecord(config) || typeof config['retentionDays'] !== 'number') {
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated above
  return config as unknown as RetentionPolicyConfig;
}

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
      const config = parseConfig(policy.config);
      if (!config) continue;
      if (config.enabled || config.userTempEnabled || config.agentTempEnabled) {
        orgsWithPolicies.push({
          organizationId: policy.organizationId,
          config,
        });
      }
    }

    const ragUrl = getRagConfig().serviceUrl;

    for (const { organizationId, config } of orgsWithPolicies) {
      const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;

      // 1. Document retention (all documents, regardless of source)
      if (config.enabled) {
        const cutoffMs =
          Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;

        const expiredDocs = await ctx.runQuery(
          internal.governance.internal_queries.listExpiredDocuments,
          { organizationId, cutoffMs, batchSize },
        );

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

      // 2. User temporary file cleanup
      if (config.userTempEnabled) {
        const hours =
          config.userTempRetentionHours ?? DEFAULT_TEMP_RETENTION_HOURS;
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

        const expiredFiles = await ctx.runQuery(
          internal.governance.internal_queries.listExpiredTempFiles,
          { organizationId, source: 'user', cutoffMs, batchSize },
        );

        for (const file of expiredFiles) {
          try {
            await fetch(
              `${ragUrl}/api/v1/documents/${encodeURIComponent(file.storageId)}`,
              { method: 'DELETE', signal: AbortSignal.timeout(30000) },
            );
          } catch (error) {
            console.warn(
              `[RetentionCleanup] Failed to delete RAG entry for temp file ${file._id}:`,
              error,
            );
          }

          await ctx.runMutation(
            internal.governance.internal_mutations_retention
              .deleteExpiredTempFile,
            { fileMetadataId: file._id },
          );
        }
      }

      // 3. Agent temporary file cleanup
      if (config.agentTempEnabled) {
        const hours =
          config.agentTempRetentionHours ?? DEFAULT_TEMP_RETENTION_HOURS;
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

        const expiredFiles = await ctx.runQuery(
          internal.governance.internal_queries.listExpiredTempFiles,
          { organizationId, source: 'agent', cutoffMs, batchSize },
        );

        for (const file of expiredFiles) {
          try {
            await fetch(
              `${ragUrl}/api/v1/documents/${encodeURIComponent(file.storageId)}`,
              { method: 'DELETE', signal: AbortSignal.timeout(30000) },
            );
          } catch (error) {
            console.warn(
              `[RetentionCleanup] Failed to delete RAG entry for temp file ${file._id}:`,
              error,
            );
          }

          await ctx.runMutation(
            internal.governance.internal_mutations_retention
              .deleteExpiredTempFile,
            { fileMetadataId: file._id },
          );
        }
      }
    }

    return null;
  },
});
