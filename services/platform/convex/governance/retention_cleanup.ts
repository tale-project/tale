'use node';

import { v } from 'convex/values';

import type { RetentionPolicyConfig } from '../../lib/shared/schemas/governance';
import type { AppliedBoundsByCategory } from '../../lib/shared/schemas/retention';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { ragFetch } from '../lib/helpers/rag_config';
import type { ActiveHolds } from './legal_hold';
import {
  clampConfigToBounds,
  isRetentionDisabled,
  type EffectiveBoundDef,
} from './retention_floors';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_TEMP_RETENTION_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Cheap shape check — used by the dispatcher to filter out orgs whose
 * stored config is missing the basic `retentionDays` field. Does NOT
 * clamp; clamping is per-org and happens in `clampStoredConfig` below
 * after the bounds file is loaded for that org.
 */
function hasValidConfigShape(config: unknown): config is RetentionPolicyConfig {
  return isRecord(config) && typeof config['retentionDays'] === 'number';
}

/**
 * Look up the per-org `retentionAppliedBounds` snapshot and clamp the
 * stored policy values against it. The applied row is the runtime
 * source of truth — operator file/env edits do NOT take effect until
 * an admin clicks Apply in the governance editor (see
 * `governance/retention_bounds_proposal.ts`).
 *
 * Returns null when:
 *   - stored config is missing required shape
 *   - the org has no applied bounds row yet (pre-migration / admin
 *     hasn't enabled retention or seeded; cleanup safely skips with a
 *     warning rather than falling back to file-as-bounds)
 *
 * The shape stored in `appliedBounds` is `Record<category, {min, max}>`,
 * which `clampConfigToBounds` consumes directly.
 */
async function clampStoredConfig(
  ctx: ActionCtx,
  organizationId: string,
  config: unknown,
): Promise<RetentionPolicyConfig | null> {
  if (!hasValidConfigShape(config)) return null;
  const applied = await ctx.runQuery(
    internal.governance.internal_queries.getAppliedBounds,
    { organizationId },
  );
  if (!applied) {
    console.warn(
      `[RetentionCleanup] org ${organizationId} has no applied retention bounds — skipping cleanup. Admin must Apply current bounds in governance editor (or run migrations/seed_applied_bounds:apply).`,
    );
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() round-trip; shape enforced by upsertAppliedBounds writers
  const appliedBounds = applied.appliedBounds as AppliedBoundsByCategory;
  return clampConfigToBounds(asEffectiveBoundsMap(appliedBounds), config);
}

/**
 * Adapt the stored `{min, max}` shape to `clampConfigToBounds`'s
 * `EffectiveBoundDef` signature. The clamp function only reads `min`
 * and `max` (per [retention_floors.ts `clampToBounds`]); the rest is
 * filler so the type lines up. Kept inline so callers don't have to
 * fabricate a fake `EffectiveBoundDef` themselves.
 */
function asEffectiveBoundsMap(
  bounds: AppliedBoundsByCategory,
): Record<string, EffectiveBoundDef> {
  const out: Record<string, EffectiveBoundDef> = {};
  for (const [cat, b] of Object.entries(bounds)) {
    out[cat] = {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime cat is always a RetentionCategory; static map is typed
      category: cat as EffectiveBoundDef['category'],
      min: b.min,
      max: b.max,
      default: b.min,
      unit: cat.endsWith('Hours') ? 'hours' : 'days',
      source: 'file',
      minEnv: { envName: '', source: 'none', applied: false },
      maxEnv: { envName: '', source: 'none', applied: false },
      defaultEnv: { envName: '', source: 'none', applied: false },
    };
  }
  return out;
}

interface OrgPolicy {
  organizationId: string;
  config: RetentionPolicyConfig;
}

async function deleteRagEntry(fileId: string, label: string): Promise<void> {
  try {
    const res = await ragFetch(
      `/api/v1/documents/${encodeURIComponent(fileId)}`,
      { method: 'DELETE', timeoutMs: 10_000 },
    );
    // 404 is success on DELETE — already gone.
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
): Promise<number> {
  if (!org.config.documentsEnabled) return 0;

  // Parity with sibling category guards. Schema rejects 0 (zod min(1)), but
  // legacy rows or unclamped pre-bound values could still reach here; treat
  // ≤0 as "disabled" rather than `cutoffMs = now` which would mass-delete.
  const days = org.config.retentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping documents cleanup`,
    );
    return 0;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  const expiredDocs = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredDocuments,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  let processed = 0;
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
      {
        documentId: doc._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupTempFiles(
  ctx: ActionCtx,
  org: OrgPolicy,
  source: 'user' | 'agent',
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  const enabled =
    source === 'user'
      ? org.config.userTempEnabled
      : org.config.agentTempEnabled;
  if (!enabled) return 0;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping ${source} temp cleanup`,
    );
    return 0;
  }

  const hours =
    (source === 'user'
      ? org.config.userTempRetentionHours
      : org.config.agentTempRetentionHours) ?? DEFAULT_TEMP_RETENTION_HOURS;
  const cutoffMs = Date.now() - hours * HOUR_MS;

  const expiredFiles = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredTempFiles,
    { organizationId: org.organizationId, source, cutoffMs, batchSize },
  );

  let processed = 0;
  for (const file of expiredFiles) {
    await deleteRagEntry(file.storageId, `temp file ${file._id}`);

    await ctx.runMutation(
      internal.governance.internal_mutations_retention.deleteExpiredTempFile,
      { fileMetadataId: file._id },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupChatHistory(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.chatHistoryEnabled) return 0;
  const days = org.config.chatHistoryRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  // Whole-org hold short-circuits the entire category — nothing in this
  // org should be physically deleted while it's preserved.
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} is on legal hold — skipping chatHistory cleanup`,
    );
    return 0;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  let processed = 0;

  // Pass A — when a grace window is configured, flip active expired
  // threads to status='expired' (no cascade yet). They land in the
  // admin Trash bucket for `graceDays` before Pass B physically removes
  // them, giving operators time to restore in case retention was
  // shortened in error.
  if (graceDays > 0) {
    const passA = await ctx.runQuery(
      internal.governance.internal_queries.listExpiredThreads,
      { organizationId: org.organizationId, cutoffMs, batchSize },
    );
    for (const thread of passA) {
      if (holds.threadIds.has(thread.threadId)) {
        console.info(
          `[RetentionCleanup] thread ${thread.threadId} on legal hold — skipping pass A`,
        );
        continue;
      }
      await ctx.runMutation(
        internal.governance.internal_mutations_retention.markThreadExpired,
        {
          threadMetadataId: thread._id,
          organizationId: org.organizationId,
          cutoffMs,
        },
      );
      // Pass A flips status without cascading rows; count the soft
      // transition so the operator panel reflects retention activity.
      processed += 1;
    }
  }

  // Pass B — cascade-delete threads whose grace has elapsed.
  // graceDays === 0 short-circuits the trash UX entirely: we list
  // active rows past the retention cutoff and cascade them directly,
  // matching the pre-Bundle-3 behavior. graceDays > 0 lists trashed
  // OR expired rows whose statusChangedAt is older than `now -
  // graceDays * DAY_MS`.
  const passB =
    graceDays > 0
      ? await ctx.runQuery(
          internal.governance.internal_queries.listGraceExpiredThreads,
          {
            organizationId: org.organizationId,
            graceCutoffMs: Date.now() - graceDays * DAY_MS,
            batchSize,
          },
        )
      : await ctx.runQuery(
          internal.governance.internal_queries.listExpiredThreads,
          { organizationId: org.organizationId, cutoffMs, batchSize },
        );

  for (const thread of passB) {
    // Per-thread hold check. The threadMetadata row's `threadId` (not
    // the Convex `_id`) is the hold target — that's what admins paste
    // into the place-hold UI and what audit logs record.
    if (holds.threadIds.has(thread.threadId)) {
      console.info(
        `[RetentionCleanup] thread ${thread.threadId} on legal hold — skipping pass B`,
      );
      continue;
    }
    // cascadeDeleteThreadChildren is page-bounded (PAGE_SIZE = 200 rows
    // per child table); for very large threads it returns
    // `{ done: false, remaining > 0 }`. Re-invoke until done.
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // 200 × 50 = 10k pages per child = 2M rows max
    let cascadeDone = false;
    while (true) {
      const result = await ctx.runMutation(
        internal.governance.internal_mutations_retention.deleteExpiredThread,
        {
          threadMetadataId: thread._id,
          organizationId: org.organizationId,
          cutoffMs,
        },
      );
      if (result.done) {
        cascadeDone = true;
        break;
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.warn(
          `[RetentionCleanup] Thread ${thread._id} cascade did not complete in ${MAX_ATTEMPTS} attempts; will resume on next run.`,
        );
        break;
      }
    }
    if (cascadeDone) processed += 1;
  }
  return processed;
}

async function cleanupAuditLogs(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  deadlineMs: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.auditLogsEnabled) return 0;
  const days = org.config.auditLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  // Audit-log spoliation is the canonical preservation-duty failure mode
  // (US FRCP 37(e), EU GDPR Art 21 challenge proceedings, ISO 27037).
  // Refuse to delete the very table that records why the hold exists.
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping audit log cleanup`,
    );
    return 0;
  }

  const olderThanTimestamp = Date.now() - days * DAY_MS;
  // High-volume orgs generate more rows/day than `batchSize` can drain in a
  // single mutation call; without this loop the audit-log table grows
  // perpetually past its retention window. Two bounds:
  //  - per-call iteration cap (defense-in-depth against runaway loops)
  //  - shared run deadline so this category yields back to the dispatcher
  //    instead of starving every later category of the 25-min budget.
  const MAX_BATCHES = 200;
  let processed = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    if (Date.now() > deadlineMs) {
      console.info(
        `[RetentionCleanup] org ${org.organizationId} auditLogs cleanup hit run deadline after ${i} batches; will resume next run`,
      );
      return processed;
    }
    const result = await ctx.runMutation(
      internal.audit_logs.internal_mutations.deleteOldLogs,
      {
        organizationId: org.organizationId,
        olderThanTimestamp,
        batchSize,
      },
    );
    processed += result.deletedCount;
    if (!result.hasMore) return processed;
  }
  console.warn(
    `[RetentionCleanup] org ${org.organizationId} auditLogs cleanup hit MAX_BATCHES=${MAX_BATCHES}; backlog remains for next run`,
  );
  return processed;
}

async function cleanupWorkflowLogs(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.workflowLogsEnabled) return 0;
  const days = org.config.workflowLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping workflow log cleanup`,
    );
    return 0;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  let processed = 0;

  const expiredExecutions = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredWorkflowExecutions,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const execution of expiredExecutions) {
    // Per-execution hold (`targetType: 'execution'`). The hold UI pastes
    // the execution `_id` as `targetId`; match exactly.
    if (holds.executionIds.has(execution._id)) {
      console.info(
        `[RetentionCleanup] execution ${execution._id} on legal hold — skipping`,
      );
      continue;
    }
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredWorkflowExecution,
      {
        executionId: execution._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }

  const expiredTriggerLogs = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredWorkflowTriggerLogs,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  for (const log of expiredTriggerLogs) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredWorkflowTriggerLog,
      {
        triggerLogId: log._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupUsageLedger(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.usageLedgerEnabled) return 0;
  const days = org.config.usageLedgerRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping usage ledger cleanup`,
    );
    return 0;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredUsageLedgerRows,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );

  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredUsageLedgerRow,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupChatFilterEvents(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.chatFilterEventsEnabled) return 0;
  const days = org.config.chatFilterEventsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;

  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping chat filter events cleanup`,
    );
    return 0;
  }

  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredChatFilterEvents,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredChatFilterEvent,
      {
        eventId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupPromptTemplates(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.promptTemplatesEnabled) return 0;
  const days = org.config.promptTemplatesRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping prompt templates cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredPromptTemplates,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredPromptTemplate,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupMessageFeedback(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.messageFeedbackEnabled) return 0;
  const days = org.config.messageFeedbackRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping message feedback cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredMessageFeedback,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredMessageFeedback,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupMemoryAudit(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.memoryAuditEnabled) return 0;
  const days = org.config.memoryAuditRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping memory audit cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredMemoryAuditRows,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredMemoryAuditRow,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

// Phase 10 — PII tables. customers / vendors / external conversations /
// messageMetadata. Each follows the same simple retention shape: list
// expired rows by `_creationTime < cutoff`, delete them. No cascade
// (these tables don't own descendants except `conversations` which
// cascades to `conversationMessages` via the dedicated mutation).

async function cleanupCustomers(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.customersEnabled) return 0;
  const days = org.config.customersRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping customers cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredCustomers,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention.deleteExpiredCustomer,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupVendors(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.vendorsEnabled) return 0;
  const days = org.config.vendorsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping vendors cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredVendors,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention.deleteExpiredVendor,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupExternalConversations(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.externalConversationsEnabled) return 0;
  const days = org.config.externalConversationsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping external conversations cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredExternalConversations,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredExternalConversation,
      {
        rowId: row._id,
        organizationId: org.organizationId,
        cutoffMs,
      },
    );
    processed += 1;
  }
  return processed;
}

async function cleanupMessageMetadata(
  ctx: ActionCtx,
  org: OrgPolicy,
  batchSize: number,
  holds: ActiveHolds,
): Promise<number> {
  if (!org.config.messageMetadataEnabled) return 0;
  const days = org.config.messageMetadataRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) {
    console.info(
      `[RetentionCleanup] org ${org.organizationId} on legal hold — skipping message metadata cleanup`,
    );
    return 0;
  }
  const cutoffMs = Date.now() - days * DAY_MS;
  // Note: messageMetadata has no `organizationId` field today (Phase 10
  // backfill is a follow-up). Until then, retention sweeps it via
  // `_creationTime` only — but ONLY removes rows whose `threadId`
  // resolves to a threadMetadata row in this org. The internal query
  // does the join.
  const expired = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredMessageMetadataForOrg,
    { organizationId: org.organizationId, cutoffMs, batchSize },
  );
  let processed = 0;
  for (const row of expired) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredMessageMetadata,
      { rowId: row._id },
    );
    processed += 1;
  }
  return processed;
}

/**
 * Phase 11 — login attempts re-frame.
 *
 * Was: cross-org retention computed as `Math.min(...enabledDays)` —
 * an org with `loginAttemptRetentionDays = 7` would silently truncate
 * the forensics window for an email that ALSO logs into a separate
 * org configured for 90 days. That's a GDPR Art 26 (joint controllers)
 * violation: each controller documents its own retention.
 *
 * Now: `loginAttempts` and `loginBlockCounters` are reframed as
 * **operational state** with a fixed 30-day TTL — long enough to
 * carry rate-limit context but short enough to limit blast radius.
 * Per-org `loginAttemptRetentionDays` config no longer governs this
 * sweep (the editor's UI exposes a help-text note explaining that
 * forensics live in the per-org `auditLogs` stream, which honors the
 * org's own auditLogRetentionDays).
 *
 * `cleanupLoginAttemptsGlobal` runs unconditionally now (no per-org
 * opt-in), once per dispatcher invocation, with the fixed TTL.
 */
const LOGIN_ATTEMPTS_FIXED_TTL_DAYS = 30;

async function cleanupLoginAttemptsGlobal(
  ctx: ActionCtx,
  _policies: OrgPolicy[], // kept for backward compat; ignored
  batchSize: number,
): Promise<number> {
  const cutoffMs = Date.now() - LOGIN_ATTEMPTS_FIXED_TTL_DAYS * DAY_MS;
  let processed = 0;

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
    processed += 1;
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
    processed += 1;
  }

  // Phase 11: parity for twoFactorAttempts. Round-2 verification
  // flagged the asymmetry — loginAttempts had a retention cron sweep
  // but 2FA attempts only had on-success-clear, so users who failed
  // 2FA and never came back left a permanently-stuck row.
  const expiredTwoFactor = await ctx.runQuery(
    internal.governance.internal_queries.listExpiredTwoFactorAttempts,
    { cutoffMs, batchSize },
  );
  for (const attempt of expiredTwoFactor) {
    await ctx.runMutation(
      internal.governance.internal_mutations_retention
        .deleteExpiredTwoFactorAttempt,
      { attemptId: attempt._id },
    );
    processed += 1;
  }
  return processed;
}

interface CategoryError {
  name: string;
  error: string;
}

async function runCategory(
  name: string,
  organizationId: string,
  fn: () => Promise<number>,
  errors: CategoryError[],
): Promise<number> {
  try {
    return await fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[RetentionCleanup] Category '${name}' failed for org ${organizationId}:`,
      error,
    );
    errors.push({ name, error: msg });
    return 0;
  }
}

/**
 * Deterministic 0-15min stagger keyed by orgId. Two orgs run by the same
 * 04:00 UTC cron land at different real times, so RAG and DB don't see a
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
    // When the budget-exhaust branch schedules a continuation, the run row
    // must stay open (`completedAt === undefined`) so that the continuation's
    // `getOpenRunForOrg` lookup can resume from the recorded cursor. Without
    // this flag, the unconditional `completeRetentionRun` in `finally` writes
    // `completedAt`, the continuation reads `null`, and the loop restarts at
    // category 0 every time — defeating the entire resume mechanism.
    let scheduledContinuation = false;
    // Per-category failures are aggregated here; previously runCategory
    // swallowed silently and `lastError` stayed `undefined` even when every
    // category crashed. Operator dashboard now sees `lastError` populated
    // with `cat:msg; cat:msg…` summaries.
    const categoryErrors: CategoryError[] = [];

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
      const config = await clampStoredConfig(
        ctx,
        args.organizationId,
        effectiveRawConfig,
      );
      if (!config) return null;

      const org: OrgPolicy = {
        organizationId: policy.organizationId,
        config,
      };
      const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
      const deadlineMs = startedAt + PER_RUN_BUDGET_MS;
      const { organizationId } = org;

      // Phase 8: effect any approved release whose 24h cooldown has
      // elapsed BEFORE we pre-fetch holds, so a freshly-effective
      // release doesn't continue protecting its target for an extra
      // day. NOTE: also called from `effectReleasesOnly` below as a
      // standalone path so the kill-switch (TALE_RETENTION_DISABLED)
      // and per-category failures can never starve approved releases.
      await ctx.runMutation(
        internal.governance.legal_hold.effectApprovedReleases,
        { organizationId },
      );

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
        run: () => Promise<number>;
      }> = [
        {
          name: 'documents',
          run: () => cleanupDocuments(ctx, org, batchSize, holds),
        },
        {
          name: 'userTempFiles',
          run: () => cleanupTempFiles(ctx, org, 'user', batchSize, holds),
        },
        {
          name: 'agentTempFiles',
          run: () => cleanupTempFiles(ctx, org, 'agent', batchSize, holds),
        },
        {
          name: 'chatHistory',
          run: () => cleanupChatHistory(ctx, org, batchSize, holds),
        },
        {
          name: 'auditLogs',
          run: () => cleanupAuditLogs(ctx, org, batchSize, deadlineMs, holds),
        },
        {
          name: 'workflowLogs',
          run: () => cleanupWorkflowLogs(ctx, org, batchSize, holds),
        },
        {
          name: 'chatFilterEvents',
          run: () => cleanupChatFilterEvents(ctx, org, batchSize, holds),
        },
        {
          name: 'promptTemplates',
          run: () => cleanupPromptTemplates(ctx, org, batchSize, holds),
        },
        {
          name: 'messageFeedback',
          run: () => cleanupMessageFeedback(ctx, org, batchSize, holds),
        },
        {
          name: 'memoryAudit',
          run: () => cleanupMemoryAudit(ctx, org, batchSize, holds),
        },
        {
          name: 'customers',
          run: () => cleanupCustomers(ctx, org, batchSize, holds),
        },
        {
          name: 'vendors',
          run: () => cleanupVendors(ctx, org, batchSize, holds),
        },
        {
          name: 'externalConversations',
          run: () => cleanupExternalConversations(ctx, org, batchSize, holds),
        },
        {
          name: 'messageMetadata',
          run: () => cleanupMessageMetadata(ctx, org, batchSize, holds),
        },
        {
          name: 'usageLedger',
          run: () => cleanupUsageLedger(ctx, org, batchSize, holds),
        },
      ];

      const cursorCategory = resumeCursor?.category;
      const skipUntilIndex =
        cursorCategory !== undefined
          ? categories.findIndex((c) => c.name === cursorCategory)
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
          scheduledContinuation = true;
          console.info(
            `[RetentionCleanup] org ${organizationId} time-budget exhausted at category=${cat.name}; continuation scheduled`,
          );
          return null;
        }

        const processedDelta = await runCategory(
          cat.name,
          organizationId,
          cat.run,
          categoryErrors,
        );
        await ctx.runMutation(
          internal.governance.retention_runs.recordRetentionRunCheckpoint,
          {
            runId: claimedRunId,
            cursor: { category: cat.name },
            processedDelta: processedDelta > 0 ? processedDelta : undefined,
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
      // Surface per-category failures in `lastError` so the operator
      // dashboard reflects partial success accurately. A try-block
      // throw still wins (it's typically a wider failure) but if all
      // 14 categories crash and the outer try succeeds, the run is
      // no longer reported green.
      if (runError === undefined && categoryErrors.length > 0) {
        runError = categoryErrors
          .map((e) => `${e.name}: ${e.error}`)
          .join('; ');
      }
      // Leave the run open when a continuation was scheduled — the next
      // invocation needs `getOpenRunForOrg` to find an in-flight row to
      // resume from its recorded cursor. The continuation (or its `catch`)
      // is responsible for closing the row eventually.
      if (!scheduledContinuation) {
        await ctx.runMutation(
          internal.governance.retention_runs.completeRetentionRun,
          { runId: claimedRunId, error: runError },
        );
      }
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
      // Dispatcher only needs to know which orgs have a non-empty
      // retention policy. Per-org bounds loading + clamping happens in
      // the scheduled per-org worker (`runOrgRetentionCleanup`), where
      // we have ctx for the file read.
      if (!hasValidConfigShape(policy.config)) continue;
      orgsWithPolicies.push({
        organizationId: policy.organizationId,
        config: policy.config,
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

    await runCategory(
      'loginAttempts',
      'global',
      () =>
        cleanupLoginAttemptsGlobal(ctx, orgsWithPolicies, DEFAULT_BATCH_SIZE),
      [],
    );

    return null;
  },
});

/**
 * Standalone path that effects approved legal-hold releases for every
 * org without running retention cleanup. Independent of the
 * `TALE_RETENTION_DISABLED` kill-switch and independent of per-category
 * failures, so a maker-checker release that has cleared its 24h cooldown
 * cannot stall indefinitely just because retention itself is paused.
 *
 * Wire to a separate cron (e.g. `0 1 * * *`) parallel to the main
 * retention cron.
 */
export const effectReleasesOnly = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const rawPolicies = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );
    for (const policy of rawPolicies) {
      try {
        await ctx.runMutation(
          internal.governance.legal_hold.effectApprovedReleases,
          { organizationId: policy.organizationId },
        );
      } catch (error) {
        console.warn(
          `[RetentionCleanup] effectReleasesOnly failed for org ${policy.organizationId}:`,
          error,
        );
      }
    }
    return null;
  },
});
