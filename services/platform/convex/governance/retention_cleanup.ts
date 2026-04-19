'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_TEMP_RETENTION_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function parseConfig(config: unknown): RetentionPolicyConfig | null {
  if (!isRecord(config) || typeof config['retentionDays'] !== 'number') {
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated above
  return config as unknown as RetentionPolicyConfig;
}

interface OrgPolicy {
  organizationId: string;
  config: RetentionPolicyConfig;
}

async function cleanupDocuments(
  ctx: ActionCtx,
  org: OrgPolicy,
  ragUrl: string,
  batchSize: number,
): Promise<void> {
  if (!org.config.enabled) return;

  const cutoffMs = Date.now() - org.config.retentionDays * DAY_MS;
  const expiredDocs = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredDocuments,
    { organizationId: org.organizationId, cutoffMs, batchSize },
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
      internal.governance.internal_mutations_retention.deleteExpiredDocument,
      { documentId: doc._id, organizationId: org.organizationId },
    );
  }
}

async function cleanupTempFiles(
  ctx: ActionCtx,
  org: OrgPolicy,
  source: 'user' | 'agent',
  ragUrl: string,
  batchSize: number,
): Promise<void> {
  const enabled =
    source === 'user'
      ? org.config.userTempEnabled
      : org.config.agentTempEnabled;
  if (!enabled) return;

  const hours =
    (source === 'user'
      ? org.config.userTempRetentionHours
      : org.config.agentTempRetentionHours) ?? DEFAULT_TEMP_RETENTION_HOURS;
  const cutoffMs = Date.now() - hours * HOUR_MS;

  const expiredFiles = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredTempFiles,
    { organizationId: org.organizationId, source, cutoffMs, batchSize },
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
      internal.governance.internal_mutations_retention.deleteExpiredTempFile,
      { fileMetadataId: file._id },
    );
  }
}

async function cleanupChatHistory(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.chatHistoryEnabled) return;
  const days = org.config.chatHistoryRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredThreads,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  for (const thread of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention.deleteExpiredThread,
      { threadMetadataId: thread._id, organizationId: org.organizationId },
    );
  }
}

async function cleanupAuditLogs(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.auditLogsEnabled) return;
  const days = org.config.auditLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  const olderThanTimestamp = Date.now() - days * DAY_MS;
  await ctx.runMutation(internal.audit_logs.internal_mutations.archiveOldLogs, {
    organizationId: org.organizationId,
    olderThanTimestamp,
    batchSize,
  });
}

async function cleanupWorkflowLogs(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.workflowLogsEnabled) return;
  const days = org.config.workflowLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  const cutoffMs = Date.now() - days * DAY_MS;

  const expiredExecutions = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredWorkflowExecutions,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const execution of expiredExecutions) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredWorkflowExecution,
      { executionId: execution._id, organizationId: org.organizationId },
    );
  }

  const expiredTriggerLogs = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredWorkflowTriggerLogs,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const log of expiredTriggerLogs) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredWorkflowTriggerLog,
      { triggerLogId: log._id, organizationId: org.organizationId },
    );
  }
}

async function cleanupUsageLedger(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.usageLedgerEnabled) return;
  const days = org.config.usageLedgerRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredUsageLedgerRows,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredUsageLedgerRow,
      { rowId: row._id, organizationId: org.organizationId },
    );
  }
}

// Login attempts are email-scoped (not org-scoped). Run as a single pass
// using the strictest (shortest) retention across any org that has the
// flag enabled. If no org enabled it, skip entirely.
async function cleanupLoginAttemptsGlobal(
  ctx: ActionCtx,
  policies: OrgPolicy[],
  batchSize: number,
): Promise<void> {
  const enabledDays = policies
    .filter((p) => p.config.loginAttemptsEnabled)
    .map((p) => p.config.loginAttemptRetentionDays)
    .filter((d): d is number => typeof d === 'number' && d > 0);

  if (enabledDays.length === 0) return;
  const minDays = Math.min(...enabledDays);
  const cutoffMs = Date.now() - minDays * DAY_MS;

  const expiredAttempts = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredLoginAttempts,
    { cutoffMs, batchSize },
  );
  for (const attempt of expiredAttempts) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredLoginAttempt,
      { attemptId: attempt._id },
    );
  }

  const expiredCounters = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredLoginBlockCounters,
    { cutoffMs, batchSize },
  );
  for (const counter of expiredCounters) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredLoginBlockCounter,
      { counterId: counter._id },
    );
  }
}

async function runCategory(
  name: string,
  organizationId: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(
      `[RetentionCleanup] Category '${name}' failed for org ${organizationId}:`,
      error,
    );
  }
}

export const runRetentionCleanup = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const rawPolicies = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );

    const orgsWithPolicies: OrgPolicy[] = [];
    for (const policy of rawPolicies) {
      const config = parseConfig(policy.config);
      if (!config) continue;
      orgsWithPolicies.push({
        organizationId: policy.organizationId,
        config,
      });
    }

    const ragUrl = getRagConfig().serviceUrl;

    for (const org of orgsWithPolicies) {
      const batchSize = org.config.batchSize ?? DEFAULT_BATCH_SIZE;
      const { organizationId } = org;

      await runCategory('documents', organizationId, () =>
        cleanupDocuments(ctx, org, ragUrl, batchSize),
      );
      await runCategory('userTempFiles', organizationId, () =>
        cleanupTempFiles(ctx, org, 'user', ragUrl, batchSize),
      );
      await runCategory('agentTempFiles', organizationId, () =>
        cleanupTempFiles(ctx, org, 'agent', ragUrl, batchSize),
      );
      await runCategory('chatHistory', organizationId, () =>
        cleanupChatHistory(ctx, org, batchSize),
      );
      await runCategory('auditLogs', organizationId, () =>
        cleanupAuditLogs(ctx, org, batchSize),
      );
      await runCategory('workflowLogs', organizationId, () =>
        cleanupWorkflowLogs(ctx, org, batchSize),
      );
      await runCategory('usageLedger', organizationId, () =>
        cleanupUsageLedger(ctx, org, batchSize),
      );
    }

    await runCategory('loginAttempts', 'global', () =>
      cleanupLoginAttemptsGlobal(ctx, orgsWithPolicies, DEFAULT_BATCH_SIZE),
    );

    return null;
  },
});
