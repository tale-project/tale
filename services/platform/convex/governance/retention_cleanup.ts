'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import { isRetentionDisabled } from './retention_floors';

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

async function deleteRagEntry(fileId: string, label: string): Promise<void> {
  const ragUrl = getRagConfig().serviceUrl;
  try {
    const res = await fetch(
      `${ragUrl}/api/v1/documents/${encodeURIComponent(fileId)}`,
      { method: 'DELETE', signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok && res.status !== 404) {
      console.warn(
        `[RetentionCleanup] RAG DELETE returned ${res.status} for ${label}`,
      );
    }
  } catch (error) {
    console.warn(
      `[RetentionCleanup] Failed to delete RAG entry for ${label}:`,
      error,
    );
  }
}

async function cleanupDocuments(
  ctx: ActionCtx,
  org: OrgPolicy,
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
      await deleteRagEntry(doc.fileId, `document ${doc._id}`);
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
    await deleteRagEntry(file.storageId, `temp file ${file._id}`);

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
    // cascadeDeleteThreadChildren is page-bounded (PAGE_SIZE = 200 rows
    // per child table); for very large threads it returns
    // `{ done: false, remaining > 0 }`. Re-invoke until done.
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // 200 × 50 = 10k pages per child = 2M rows max
    while (true) {
      const result = await ctx.runMutation(
        internal.governance.internal_mutations_retention.deleteExpiredThread,
        { threadMetadataId: thread._id, organizationId: org.organizationId },
      );
      if (result.done) break;
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.warn(
          `[RetentionCleanup] Thread ${thread._id} cascade did not complete in ${MAX_ATTEMPTS} attempts; will resume on next run.`,
        );
        break;
      }
    }
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

async function cleanupChatFilterEvents(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.chatFilterEventsEnabled) return;
  const days = org.config.chatFilterEventsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredChatFilterEvents,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredChatFilterEvent,
      { eventId: row._id, organizationId: org.organizationId },
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

/**
 * Deterministic 0-15min stagger keyed by orgId. Two orgs run by the same
 * 03:00 UTC cron land at different real times, so RAG and DB don't see a
 * thundering-herd on every cron tick. Hash is FNV-1a-style: stable across
 * processes (no Math.random), so the same org runs at the same wall-clock
 * offset every day — useful for operator log triage.
 */
function jitterMsForOrg(organizationId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < organizationId.length; i++) {
    hash ^= organizationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % (15 * 60 * 1000); // 0 – 15 min
}

/**
 * Per-org cleanup: runs every retention category for one org. Wrapped in
 * its own action so the top-level dispatcher can schedule it via
 * `ctx.scheduler.runAfter(jitterMs, …)`, isolating per-org failures and
 * bounding each invocation's runtime.
 */
export const runOrgRetentionCleanup = internalAction({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (isRetentionDisabled()) {
      console.warn(
        '[RetentionCleanup] TALE_RETENTION_DISABLED=true — skipping run',
      );
      return null;
    }
    const rawPolicies = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );
    const policy = rawPolicies.find(
      (p) => p.organizationId === args.organizationId,
    );
    if (!policy) return null;
    const config = parseConfig(policy.config);
    if (!config) return null;

    const org: OrgPolicy = {
      organizationId: policy.organizationId,
      config,
    };
    const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    const { organizationId } = org;

    await runCategory('documents', organizationId, () =>
      cleanupDocuments(ctx, org, batchSize),
    );
    await runCategory('userTempFiles', organizationId, () =>
      cleanupTempFiles(ctx, org, 'user', batchSize),
    );
    await runCategory('agentTempFiles', organizationId, () =>
      cleanupTempFiles(ctx, org, 'agent', batchSize),
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
    await runCategory('chatFilterEvents', organizationId, () =>
      cleanupChatFilterEvents(ctx, org, batchSize),
    );
    await runCategory('usageLedger', organizationId, () =>
      cleanupUsageLedger(ctx, org, batchSize),
    );

    return null;
  },
});

export const runRetentionCleanup = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    if (isRetentionDisabled()) {
      console.warn(
        '[RetentionCleanup] TALE_RETENTION_DISABLED=true — skipping run',
      );
      return null;
    }
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

    // Dispatcher: schedule a per-org cleanup with a deterministic 0-15min
    // jitter. The dispatcher itself returns in seconds — workers run in
    // parallel under the scheduler, so org A's cleanup can't block org B.
    for (const org of orgsWithPolicies) {
      await ctx.scheduler.runAfter(
        jitterMsForOrg(org.organizationId),
        internal.governance.retention_cleanup.runOrgRetentionCleanup,
        { organizationId: org.organizationId },
      );
    }

    await runCategory('loginAttempts', 'global', () =>
      cleanupLoginAttemptsGlobal(ctx, orgsWithPolicies, DEFAULT_BATCH_SIZE),
    );

    return null;
  },
});
