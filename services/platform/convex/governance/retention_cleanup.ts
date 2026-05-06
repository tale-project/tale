'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import type { ActiveHolds } from './legal_hold';
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
  holds: ActiveHolds,
): Promise<void> {
  if (!org.config.enabled) return;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping documents cleanup`,
    );
    return;
  }

  const cutoffMs = Date.now() - org.config.retentionDays * DAY_MS;
  const expiredDocs = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredDocuments,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  for (const doc of expiredDocs) {
    if (holds.documentIds.has(doc._id)) {
      console.info(
        `[RetentionCleanup] document ${doc._id} on legal hold — skipping`,
      );
      continue;
    }

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
  holds: ActiveHolds,
): Promise<void> {
  if (!org.config.chatHistoryEnabled) return;
  const days = org.config.chatHistoryRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;

  // Whole-org hold short-circuits the entire category — nothing in this
  // org should be physically deleted while it's preserved.
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} is on legal hold — skipping chatHistory cleanup`,
    );
    return;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredThreads,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  for (const thread of expired) {
    // Per-thread hold check. The threadMetadata row's `threadId` (not
    // the Convex `_id`) is the hold target — that's what admins paste
    // into the place-hold UI and what audit logs record.
    if (holds.threadIds.has(thread.threadId)) {
      console.info(
        `[RetentionCleanup] thread ${thread.threadId} is on legal hold — skipping`,
      );
      continue;
    }
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
  await ctx.runMutation(internal.audit_logs.internal_mutations.deleteOldLogs, {
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

async function cleanupPromptTemplates(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.promptTemplatesEnabled) return;
  const days = org.config.promptTemplatesRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredPromptTemplates,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredPromptTemplate,
      { rowId: row._id, organizationId: org.organizationId },
    );
  }
}

async function cleanupMessageFeedback(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.messageFeedbackEnabled) return;
  const days = org.config.messageFeedbackRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredMessageFeedback,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredMessageFeedback,
      { rowId: row._id, organizationId: org.organizationId },
    );
  }
}

async function cleanupMemoryAudit(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
): Promise<void> {
  if (!org.config.memoryAuditEnabled) return;
  const days = org.config.memoryAuditRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredMemoryAuditRows,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredMemoryAuditRow,
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
/** 25-min budget gives a 5-min margin under the 30-min self-hosted action ceiling. */
const PER_RUN_BUDGET_MS = 25 * 60 * 1000;

export const runOrgRetentionCleanup = internalAction({
  args: {
    organizationId: v.string(),
    /** Set when this invocation is a continuation from a prior run that
     *  exhausted its time budget. The worker resumes from `lastCursor`
     *  on the existing retention-run row instead of claiming a new one. */
    resumeRunId: v.optional(v.id('retentionRuns')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (isRetentionDisabled()) {
      console.warn(
        '[RetentionCleanup] TALE_RETENTION_DISABLED=true — skipping run',
      );
      return null;
    }

    // Phase 7 — claim or resume an in-flight retention run row. Concurrent
    // dispatcher fires (cron overlap) or accidental scheduler duplication
    // get short-circuited at this point.
    let runId: Id<'retentionRuns'> | null = null;
    let resumeCursor:
      | { category: string; step?: string; lastCreationTime?: number }
      | undefined;
    if (args.resumeRunId) {
      runId = args.resumeRunId;
      const open = await ctx.runQuery(
        internal.governance.retention_runs.getOpenRunForOrg,
        { organizationId: args.organizationId },
      );
      resumeCursor =
        open && open._id === args.resumeRunId ? open.lastCursor : undefined;
    } else {
      runId = await ctx.runMutation(
        internal.governance.retention_runs.claimRetentionRun,
        { organizationId: args.organizationId },
      );
      if (!runId) {
        console.info(
          `[RetentionCleanup] org ${args.organizationId} skipped — previous run still in-flight`,
        );
        return null;
      }
    }
    const claimedRunId = runId;

    const startedAt = Date.now();
    let runError: string | undefined;

    try {
      const rawPolicies = await ctx.runQuery(
        internal.governance.internal_queries.listRetentionPolicies,
        {},
      );
      const policy = rawPolicies.find(
        (p) => p.organizationId === args.organizationId,
      );
      if (!policy) return null;

      // Phase 3 — pending-change cooldown.
      // If there's a `retentionPolicyPendingChanges` row for this org:
      //   - appliesAt in the future → use OLD config (cooldown active).
      //   - appliesAt elapsed       → finalize (delete pending row) +
      //                                use NEW config from policy row.
      const pending = await ctx.runQuery(
        internal.governance.internal_queries.getPendingRetentionChange,
        { organizationId: args.organizationId },
      );
      let effectiveRawConfig: unknown = policy.config;
      if (pending) {
        if (pending.appliesAt > Date.now()) {
          effectiveRawConfig = pending.oldConfig;
          console.info(
            `[RetentionCleanup] org ${args.organizationId} retention shortening pending until ${new Date(pending.appliesAt).toISOString()} — using oldConfig (${pending.summary})`,
          );
        } else {
          await ctx.runMutation(
            internal.governance.internal_mutations_retention
              .finalizePendingRetentionChange,
            {
              pendingId: pending._id,
              organizationId: args.organizationId,
            },
          );
        }
      }
      const config = parseConfig(effectiveRawConfig);
      if (!config) return null;

      const org: OrgPolicy = {
        organizationId: policy.organizationId,
        config,
      };
      const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
      const { organizationId } = org;

      // Phase 8: pre-fetch every active legal hold ONCE per cleanup run.
      const holdRows = await ctx.runQuery(
        internal.governance.legal_hold_internal.loadActiveHoldsForOrg,
        { organizationId },
      );
      const holds: ActiveHolds = {
        orgHeld: holdRows.orgHeld,
        threadIds: new Set(holdRows.threadIds),
        documentIds: new Set(holdRows.documentIds),
        executionIds: new Set(holdRows.executionIds),
        userMembershipIds: new Set(holdRows.userMembershipIds),
      };

      // Sequenced category list. We honor the resumeCursor by skipping
      // categories that ran to completion in a prior continuation.
      const categories: Array<{
        name: string;
        run: () => Promise<void>;
      }> = [
        {
          name: 'documents',
          run: () => cleanupDocuments(ctx, org, batchSize, holds),
        },
        {
          name: 'userTempFiles',
          run: () => cleanupTempFiles(ctx, org, 'user', batchSize),
        },
        {
          name: 'agentTempFiles',
          run: () => cleanupTempFiles(ctx, org, 'agent', batchSize),
        },
        {
          name: 'chatHistory',
          run: () => cleanupChatHistory(ctx, org, batchSize, holds),
        },
        {
          name: 'auditLogs',
          run: () => cleanupAuditLogs(ctx, org, batchSize),
        },
        {
          name: 'workflowLogs',
          run: () => cleanupWorkflowLogs(ctx, org, batchSize),
        },
        {
          name: 'chatFilterEvents',
          run: () => cleanupChatFilterEvents(ctx, org, batchSize),
        },
        {
          name: 'promptTemplates',
          run: () => cleanupPromptTemplates(ctx, org, batchSize),
        },
        {
          name: 'messageFeedback',
          run: () => cleanupMessageFeedback(ctx, org, batchSize),
        },
        {
          name: 'memoryAudit',
          run: () => cleanupMemoryAudit(ctx, org, batchSize),
        },
        {
          name: 'usageLedger',
          run: () => cleanupUsageLedger(ctx, org, batchSize),
        },
      ];

      const skipUntilIndex = resumeCursor
        ? categories.findIndex((c) => c.name === resumeCursor!.category)
        : -1;

      for (let i = 0; i < categories.length; i++) {
        if (skipUntilIndex >= 0 && i < skipUntilIndex) continue;
        const cat = categories[i];

        // Time budget — schedule continuation if we'd risk hitting the
        // 30-min action ceiling.
        if (Date.now() - startedAt > PER_RUN_BUDGET_MS) {
          await ctx.runMutation(
            internal.governance.retention_runs.recordRetentionRunCheckpoint,
            {
              runId: claimedRunId,
              cursor: { category: cat.name },
            },
          );
          await ctx.scheduler.runAfter(
            0,
            internal.governance.retention_cleanup.runOrgRetentionCleanup,
            {
              organizationId: args.organizationId,
              resumeRunId: claimedRunId,
            },
          );
          console.info(
            `[RetentionCleanup] org ${organizationId} time-budget exhausted at category=${cat.name}; continuation scheduled`,
          );
          return null;
        }

        await runCategory(cat.name, organizationId, cat.run);
        await ctx.runMutation(
          internal.governance.retention_runs.recordRetentionRunCheckpoint,
          {
            runId: claimedRunId,
            cursor: { category: cat.name },
          },
        );
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err);
      console.error(
        `[RetentionCleanup] org ${args.organizationId} failed:`,
        err,
      );
    } finally {
      // Mark complete regardless — the next dispatcher fire will start
      // fresh tomorrow. A continuation explicitly re-uses this id.
      await ctx.runMutation(
        internal.governance.retention_runs.completeRetentionRun,
        { runId: claimedRunId, error: runError },
      );
    }

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
