import { randomUUID } from 'node:crypto';

import type { RetentionPolicyConfig } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  retentionDefaultsConfigSchema,
  type RetentionCategory,
} from '../../../lib/shared/schemas/retention.ts';
import {
  applyEnvTighteningAll,
  clampConfigToBounds,
  isRetentionDisabled,
  type EffectiveBoundDef,
} from '../../core/governance/retention_floors.ts';
import { readDomainConfigFile } from '../../core/lib/config_store/read_domain_file.ts';
import { getConfigRoot } from '../../core/lib/file_io.ts';
import { toJson } from '../../db/sql.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { createAuditLog, lockAuditChain } from '../audit_logs/service.ts';
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import {
  indexedMessageRefsOf,
  queueMessageRefRelease,
} from '../conversations/message-corpus.ts';
import { emitDocumentChangeHints } from '../documents/hints.ts';
import { releaseRefs, type ReleaseFailure } from '../knowledge/release.ts';
import { syncRagRefHolderScopes } from '../knowledge/service.ts';
import {
  markEntryChainDeletedForDocument,
  markEntryChainsDeletedForDocuments,
} from '../knowledge_entries/service.ts';
import { loadActiveHolds, type ActiveHolds } from '../legal_holds/service.ts';
import { cascadeDeleteThreadTtsChunks } from '../tts/service.ts';

/**
 * The retention framework — the 0.5 twin of
 * `convex/governance/retention_cleanup.ts` (phase 1): the APPLIED-BOUNDS
 * snapshot (file × env tightening, reused pure `retention_floors`;
 * operator edits take effect only when an admin applies), the daily
 * cleanup dispatcher (per-org: policy file clamped to the applied row,
 * holds pre-fetched once), and the first category sweeps — usage ledger,
 * message feedback, both notification tables, and the guardrail verdicts.
 *
 * DELIBERATE phase-1 simplification: the 0.4 two-pass grace model (mark
 * `expired` → admin Trash → physical delete after grace) collapses to a
 * direct delete past `retention + grace` for these row-level categories —
 * the same end state; the visible-trash pass matters for THREADS and
 * DOCUMENTS, which ride the next phase with their own lifecycle columns.
 * `TALE_RETENTION_DISABLED=true` is the operator kill-switch. Every org run
 * writes its own audit trail — see "the audit trail" below.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 1_000;

/**
 * DELETE rounds the chat-filter-event sweep may take in one run (50,000
 * events per organization). A backlog beyond it — the first run after the
 * category is enabled on months of history — drains over the following
 * nights instead of in one long transaction.
 */
export const CHAT_FILTER_EVENT_MAX_BATCHES = 50;

export class RetentionError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'RetentionError';
    this.code = code;
    this.status = status;
  }
}

const MAX_RETENTION_FILE_BYTES = 256 * 1024;

/** The org's retention DEFAULTS/BOUNDS file (its OWN file only — every org
 * is seeded from the catalog at create; no cross-org fallback). A file that
 * exists but does not parse — a bound below its compliance floor, say —
 * reads as no file, so its reason goes to the log: the editor shows only
 * that the bounds are missing. */
export async function loadOrgRetentionConfig(orgSlug: string) {
  const path = await import('node:path');
  const dir = path.join(getConfigRoot('retention'), orgSlug, 'governance');
  const result = await readDomainConfigFile(
    dir,
    'retention',
    MAX_RETENTION_FILE_BYTES,
    (data) => retentionDefaultsConfigSchema.parse(data),
  );
  if (result.ok) return result.data;
  if (result.error !== 'not_found') {
    console.warn(
      `[retention] bounds file unreadable for org ${orgSlug}: ${result.message}`,
    );
  }
  return null;
}

export type AppliedBounds = Partial<
  Record<RetentionCategory, { min: number; max: number }>
>;

/** Compute the effective bounds (file × env) as the minimal snapshot. */
export async function computeEffectiveAppliedBounds(
  orgSlug: string,
): Promise<AppliedBounds> {
  const orgConfig = await loadOrgRetentionConfig(orgSlug);
  if (!orgConfig) {
    throw new RetentionError(
      'RETENTION_CONFIG_MISSING',
      `Retention config not yet installed for ${orgSlug} — copy the catalog's governance/retention.yml into the org's config tree.`,
      404,
    );
  }
  const out: AppliedBounds = {};
  for (const def of applyEnvTighteningAll(orgConfig)) {
    out[def.category] = { min: def.min, max: def.max };
  }
  return out;
}

/** Snapshot the current effective bounds as the org's applied row. */
export async function applyRetentionBounds(
  sql: Sql,
  args: { organizationId: string; actorId: string; actorEmail?: string },
): Promise<AppliedBounds> {
  const orgSlug = await resolveOrgSlug(sql, args.organizationId);
  if (orgSlug === null) {
    throw new RetentionError('ORG_NOT_FOUND', 'Unknown organization', 404);
  }
  const bounds = await computeEffectiveAppliedBounds(orgSlug);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app.retention_applied_bounds (
        org_id, bounds, applied_by, applied_at_ms
      ) VALUES (
        ${args.organizationId}, ${tx.json(toJson(bounds))}, ${args.actorId},
        ${Date.now()}
      )
      ON CONFLICT (org_id) DO UPDATE SET
        bounds = EXCLUDED.bounds, applied_by = EXCLUDED.applied_by,
        applied_at_ms = EXCLUDED.applied_at_ms
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'policy.retention_bounds_applied',
      category: 'admin',
      resourceType: 'retention_bounds',
      resourceId: args.organizationId,
      resourceName: orgSlug,
      status: 'success',
      newState: { bounds },
    });
  });
  return bounds;
}

export async function getAppliedBounds(
  sql: Sql,
  organizationId: string,
): Promise<{
  bounds: AppliedBounds;
  appliedAt: number;
  rejectedBoundsHash: string | null;
} | null> {
  const rows = await sql<
    {
      bounds: AppliedBounds;
      appliedAt: number;
      rejectedBoundsHash: string | null;
    }[]
  >`
    SELECT bounds, applied_at_ms::float8 AS "appliedAt",
           rejected_bounds_hash AS "rejectedBoundsHash"
    FROM app.retention_applied_bounds
    WHERE org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Silence the bounds banner for exactly this operator hash (the 0.4
 * `rejectedBoundsHash`); a later divergence surfaces it again. */
export async function setRejectedBoundsHash(
  sql: Sql,
  organizationId: string,
  hash: string,
): Promise<boolean> {
  const rows = await sql<{ orgId: string }[]>`
    UPDATE app.retention_applied_bounds
    SET rejected_bounds_hash = ${hash}
    WHERE org_id = ${organizationId}
    RETURNING org_id AS "orgId"
  `;
  return rows[0] !== undefined;
}

interface OrgPolicy {
  organizationId: string;
  config: RetentionPolicyConfig;
}

/** During a staged shortening's 7-day cooldown the SWEEP keeps enforcing
 * the longer pre-save values (the file already holds the new config; the
 * pending row snapshots the old one). Per numeric retention key the
 * enforcement value is max(old, new) — reductions wait out the cooldown,
 * extensions apply immediately. */
async function overlayPendingShorteningCooldown(
  sql: Sql,
  organizationId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const pending = await sql<{ oldConfig: Record<string, unknown> }[]>`
    SELECT old_config AS "oldConfig"
    FROM app.retention_policy_pending_changes
    WHERE org_id = ${organizationId} AND applies_at_ms > ${Date.now()}
    LIMIT 1
  `;
  const oldConfig = pending[0]?.oldConfig;
  if (oldConfig === undefined) return;
  for (const [key, oldValue] of Object.entries(oldConfig)) {
    if (!/Retention(Days|Hours)$/.test(key) && key !== 'deletionGraceDays') {
      continue;
    }
    const newValue = config[key];
    if (
      typeof oldValue === 'number' &&
      typeof newValue === 'number' &&
      oldValue > newValue
    ) {
      config[key] = oldValue;
    }
  }
}

/** The policy file clamped to the org's APPLIED bounds — null when the org
 * has no valid policy or never applied bounds (cleanup safely skips). */
async function clampedPolicyFor(
  sql: Sql,
  organizationId: string,
): Promise<OrgPolicy | null> {
  const config = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'retention_policy',
  );
  if (!config || typeof config.documentsRetentionDays !== 'number') {
    return null;
  }
  // Overlay onto a COPY — `readGovernancePolicyForOrg` hands back a cached
  // object, and mutating it would freeze the pre-cooldown values in the
  // cache long after the pending row expired.
  const effectiveConfig = { ...config };
  await overlayPendingShorteningCooldown(sql, organizationId, effectiveConfig);
  const applied = await getAppliedBounds(sql, organizationId);
  if (applied === null) {
    console.warn(
      `[retention] org ${organizationId} has a policy but no applied bounds — skipping (apply bounds in the governance editor)`,
    );
    return null;
  }
  const boundsByCategory: Record<string, EffectiveBoundDef> = {};
  for (const [category, bound] of Object.entries(applied.bounds)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the clamp reads only min/max; the snapshot stores exactly those
    boundsByCategory[category] = bound as EffectiveBoundDef;
  }
  return {
    organizationId,
    config: clampConfigToBounds(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keyed by the same category union the snapshot was built from
      boundsByCategory as Record<RetentionCategory, EffectiveBoundDef>,
      effectiveConfig,
    ),
  };
}

// ------------------------------------------------------- the audit trail

/**
 * Every org run leaves its evidence on that org's audit chain, written as
 * the `system` actor under the `data` category: `retention.run_started`
 * (the clamped policy the run enforces), ONE `<entity>.retention_deleted`
 * row per category that destroyed anything — with its counts, never a row
 * per record — and `retention.run_completed` or `retention.run_failed` with
 * every category's tally. The names are the 0.4 ones (`retention_runs.ts`
 * and its per-record deletes); the categories 0.4 never audited take the
 * same `<entity>.retention_deleted` shape. Every row names its run
 * (`retention_run` + the run's id), so one run reads back whole.
 *
 * A category whose deletes are plain SQL appends its row in the SAME
 * transaction, so the evidence commits or rolls back with the destruction
 * it describes. The purge lanes — documents, chat lineages, temp files —
 * cannot: each record's corpus rows and blobs are released over the network
 * before its rows are deleted in a transaction of its own, and holding a
 * batch's row deletes back for one closing transaction would let two records
 * that share a blob each find the other still holding it (`releaseRefs`
 * excludes only the record being purged), so the blob would outlive both.
 * Their row follows the batch and counts only the purges that committed.
 */

type SweepCategory = keyof SweepStats | keyof Phase2Stats;

const DELETED_ACTION: Record<SweepCategory, string> = {
  usageLedger: 'usage_ledger.retention_deleted',
  messageFeedback: 'message_feedback.retention_deleted',
  notifications: 'notification.retention_deleted',
  chatFilterEvents: 'chat_filter_event.retention_deleted',
  documents: 'document.retention_deleted',
  chatHistory: 'chat_history.retention_deleted',
  contacts: 'contact.retention_deleted',
  externalConversations: 'external_conversation.retention_deleted',
  agentRuns: 'agent_run.retention_deleted',
  automationRuns: 'automation_run.retention_deleted',
  auditLogs: 'audit_log.retention_deleted',
  tempFiles: 'file_metadata.retention_deleted',
  sandboxLedgers: 'sandbox_ledger.retention_deleted',
};

/** What one category did in one run. */
interface CategoryTally {
  /** Rows destroyed. */
  deleted: number;
  /** Rows the expiry pass moved into the admin Trash — restorable, so not
   * destruction: counted on the run's closing row only. */
  expired: number;
  /** Due rows kept because their purge failed; the next run retries. */
  failed: number;
}

/** One org's cleanup run, as its audit chain records it. */
interface RetentionRun {
  readonly id: string;
  readonly organizationId: string;
  readonly startedAt: number;
  /** Booked as each category's work commits — also when one throws midway,
   * so the failure row still counts what was destroyed before it. */
  readonly tallies: Partial<Record<SweepCategory, CategoryTally>>;
  /** The category in flight: what a thrown error is charged to. */
  current: SweepCategory | null;
}

/** One category's share of a run: its tally, and where its row goes. */
interface CategoryTrail {
  readonly run: RetentionRun;
  readonly category: SweepCategory;
  readonly tally: CategoryTally;
}

/** What a category's destruction row says. */
interface Destruction {
  deleted: number;
  /** The split by table (or by source) when the category spans several. */
  counts?: Record<string, number>;
  /** Due rows a failed purge kept for the next run. */
  failed?: number;
  /** Evidence particular to the category (the audit prefix's cut). */
  detail?: Record<string, unknown>;
}

const MAX_RUN_ERROR_CHARS = 500;

function newRetentionRun(organizationId: string): RetentionRun {
  return {
    id: randomUUID(),
    organizationId,
    startedAt: Date.now(),
    tallies: {},
    current: null,
  };
}

/** The frame every row of one run shares. */
function runAuditFields(run: RetentionRun) {
  return {
    organizationId: run.organizationId,
    actorId: 'system',
    actorType: 'system',
    category: 'data',
    resourceType: 'retention_run',
    resourceId: run.id,
  } as const;
}

/** Run one category under its own tally; answers its figure in the
 * cleanup's result — rows destroyed or moved to the Trash. */
async function sweepCategory(
  run: RetentionRun,
  category: SweepCategory,
  sweep: (trail: CategoryTrail) => Promise<void>,
): Promise<number> {
  const tally: CategoryTally = { deleted: 0, expired: 0, failed: 0 };
  run.tallies[category] = tally;
  run.current = category;
  await sweep({ run, category, tally });
  run.current = null;
  return tally.deleted + tally.expired;
}

/** Append a category's destruction row inside the caller's transaction.
 * Nothing destroyed, no row: the run's closing row carries the zeros. */
async function recordDestruction(
  tx: TransactionSql,
  trail: CategoryTrail,
  destruction: Destruction,
): Promise<void> {
  if (destruction.deleted <= 0) return;
  await createAuditLog(tx, {
    ...runAuditFields(trail.run),
    action: DELETED_ACTION[trail.category],
    status: 'success',
    metadata: {
      category: trail.category,
      deleted: destruction.deleted,
      ...(destruction.counts !== undefined
        ? { counts: destruction.counts }
        : {}),
      ...(destruction.failed !== undefined && destruction.failed > 0
        ? { failed: destruction.failed }
        : {}),
      ...destruction.detail,
    },
  });
}

/** A plain-SQL category: its deletes and its row in ONE transaction, the
 * count booked once that transaction has committed. */
async function destroyInTx(
  sql: Sql,
  trail: CategoryTrail,
  deletes: (tx: TransactionSql) => Promise<Destruction>,
): Promise<void> {
  const destruction = await sql.begin(async (tx) => {
    const done = await deletes(tx);
    await recordDestruction(tx, trail, done);
    return done;
  });
  trail.tally.deleted += destruction.deleted;
}

/** A purge lane's row, written once its per-record transactions are done. */
async function recordPurgedBatch(
  sql: Sql,
  trail: CategoryTrail,
  destruction: Destruction,
): Promise<void> {
  if (destruction.deleted <= 0) return;
  await sql.begin((tx) => recordDestruction(tx, trail, destruction));
}

async function recordRunStarted(
  sql: Sql,
  run: RetentionRun,
  policy: OrgPolicy,
  holds: ActiveHolds,
): Promise<void> {
  await sql.begin((tx) =>
    createAuditLog(tx, {
      ...runAuditFields(run),
      action: 'retention.run_started',
      status: 'success',
      metadata: {
        policy: policy.config,
        holds: {
          organization: holds.orgHeld,
          custodians: holds.userMembershipIds.size,
        },
      },
    }),
  );
}

/**
 * The run's closing row: `retention.run_completed`, or `retention.run_failed`
 * when the run threw or a due record's purge failed (0.4's rule: a category
 * that could not finish fails the run). Never throws — the chain may be the
 * very thing that is down — so a row it cannot write is logged instead.
 */
async function recordRunFinished(
  sql: Sql,
  run: RetentionRun,
  thrown?: { error: unknown },
): Promise<void> {
  let deleted = 0;
  const categories: Record<string, Record<string, number>> = {};
  const keptBack: string[] = [];
  for (const [category, tally] of Object.entries(run.tallies)) {
    deleted += tally.deleted;
    const nonZero = Object.fromEntries(
      Object.entries(tally).filter(([, count]) => count > 0),
    );
    if (Object.keys(nonZero).length > 0) categories[category] = nonZero;
    if (tally.failed > 0) {
      keptBack.push(`${category}: ${tally.failed} kept after a failed purge`);
    }
  }
  const errorMessage =
    thrown !== undefined
      ? (thrown.error instanceof Error
          ? thrown.error.message
          : String(thrown.error)
        ).slice(0, MAX_RUN_ERROR_CHARS)
      : keptBack.length > 0
        ? keptBack.join('; ')
        : null;
  try {
    await sql.begin((tx) =>
      createAuditLog(tx, {
        ...runAuditFields(run),
        action:
          errorMessage === null
            ? 'retention.run_completed'
            : 'retention.run_failed',
        status: errorMessage === null ? 'success' : 'failure',
        ...(errorMessage !== null ? { errorMessage } : {}),
        metadata: {
          durationMs: Date.now() - run.startedAt,
          deleted,
          categories,
          ...(thrown !== undefined && run.current !== null
            ? { failedCategory: run.current }
            : {}),
        },
      }),
    );
  } catch (error) {
    console.error(
      `[retention] org ${run.organizationId}: could not record the end of run ${run.id}:`,
      error,
    );
  }
}

interface SweepStats {
  usageLedger: number;
  messageFeedback: number;
  notifications: number;
  chatFilterEvents: number;
}

function cutoffFor(days: number | undefined, graceDays: number): number | null {
  if (typeof days !== 'number' || days <= 0 || !Number.isFinite(days)) {
    return null;
  }
  return Date.now() - (days + graceDays) * DAY_MS;
}

/** One org's category sweeps (phase-1 set). Holds pre-fetched once. */
async function sweepOrg(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  run: RetentionRun,
): Promise<SweepStats> {
  const stats: SweepStats = {
    usageLedger: 0,
    messageFeedback: 0,
    notifications: 0,
    chatFilterEvents: 0,
  };
  if (holds.orgHeld) {
    console.info(
      `[retention] org ${org.organizationId} on legal hold — skipping all categories`,
    );
    return stats;
  }
  stats.usageLedger = await sweepCategory(run, 'usageLedger', (trail) =>
    sweepUsageLedger(sql, org, holds, trail),
  );
  stats.messageFeedback = await sweepCategory(run, 'messageFeedback', (trail) =>
    sweepMessageFeedback(sql, org, holds, trail),
  );
  stats.notifications = await sweepCategory(run, 'notifications', (trail) =>
    sweepNotifications(sql, org, holds, trail),
  );
  stats.chatFilterEvents = await sweepCategory(
    run,
    'chatFilterEvents',
    (trail) => sweepChatFilterEvents(sql, org, holds, trail),
  );
  return stats;
}

async function sweepUsageLedger(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.usageLedgerEnabled !== true) return;
  const cutoff = cutoffFor(
    org.config.usageLedgerRetentionDays,
    org.config.deletionGraceDays ?? 0,
  );
  if (cutoff === null) return;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    const ledger = await tx<{ id: string }[]>`
      DELETE FROM app.usage_ledger
      WHERE ctid IN (
        SELECT ctid FROM app.usage_ledger
        WHERE org_id = ${org.organizationId}
          AND updated_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR user_id <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING org_id AS id
    `;
    // The retired per-turn rows the chat lane wrote beside the ledger (no
    // reader; the table goes in a later release) age out on the same clock.
    const events = await tx<{ id: string }[]>`
      DELETE FROM app.usage_events
      WHERE ctid IN (
        SELECT ctid FROM app.usage_events
        WHERE org_id = ${org.organizationId}
          AND created_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR user_id <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    // A project's own buckets — the same spend, summed per project — age
    // out with the ledger. They name no person, so no member's hold keeps
    // them; an organization's hold skips the whole run.
    const projects = await tx<{ id: string }[]>`
      DELETE FROM app.project_usage
      WHERE ctid IN (
        SELECT ctid FROM app.project_usage
        WHERE org_id = ${org.organizationId}
          AND updated_at_ms < ${cutoff}
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING org_id AS id
    `;
    return {
      deleted: ledger.length + events.length + projects.length,
      counts: {
        usageLedger: ledger.length,
        usageEvents: events.length,
        projectUsage: projects.length,
      },
    };
  });
}

async function sweepMessageFeedback(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.messageFeedbackEnabled !== true) return;
  const cutoff = cutoffFor(
    org.config.messageFeedbackRetentionDays,
    org.config.deletionGraceDays ?? 0,
  );
  if (cutoff === null) return;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      DELETE FROM app.message_feedback
      WHERE id IN (
        SELECT id FROM app.message_feedback
        WHERE org_id = ${org.organizationId}
          AND created_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR user_id <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    return { deleted: rows.length };
  });
}

async function sweepNotifications(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.notificationsEnabled !== true) return;
  const cutoff = cutoffFor(
    org.config.notificationsRetentionDays,
    org.config.deletionGraceDays ?? 0,
  );
  if (cutoff === null) return;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    const orgRows = await tx<{ id: string }[]>`
      DELETE FROM app.notifications
      WHERE id IN (
        SELECT id FROM app.notifications
        WHERE org_id = ${org.organizationId}
          AND created_at_ms < ${cutoff}
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    const userRows = await tx<{ id: string }[]>`
      DELETE FROM app.user_notifications
      WHERE id IN (
        SELECT id FROM app.user_notifications
        WHERE org_id = ${org.organizationId}
          AND created_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR user_id <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    return {
      deleted: orgRows.length + userRows.length,
      counts: {
        notifications: orgRows.length,
        userNotifications: userRows.length,
      },
    };
  });
}

/**
 * The `chatFilterEvents` category — `app.chat_filter_events`, one row per
 * non-pass guardrail verdict of a chat turn, which the Guardrails page's
 * recent events and the chat-health stats read. Written since the guardrail
 * chain landed and, until this sweep, never deleted, whatever the policy
 * said. Aged by `created_at_ms` (served by `chat_filter_events_org_created`)
 * past the window plus the grace, like the other row-level categories: the
 * table has no lifecycle column, so there is no Trash stop.
 *
 * The row carries no user column; its custodian is the owner of the chat
 * that raised it, the same `thread_metadata.user_id` the chat-history sweep
 * protects by. A held member's events stay as long as their chat does, and
 * the filter lives in SQL so held rows can never fill the batch. An event
 * whose thread is gone has no owner left to hold it.
 *
 * Unlike its siblings, the category DRAINS: a chat turn can raise several
 * events, so one org can write more than a batch a day, and a single batch
 * per run would never catch up. It deletes batch after batch until one
 * comes back short or `CHAT_FILTER_EVENT_MAX_BATCHES` is spent, all in ONE
 * transaction, so the run still leaves one destruction row whose count
 * commits with the rows it names.
 */
async function sweepChatFilterEvents(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.chatFilterEventsEnabled !== true) return;
  const cutoff = cutoffFor(
    org.config.chatFilterEventsRetentionDays,
    org.config.deletionGraceDays ?? 0,
  );
  if (cutoff === null) return;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    let deleted = 0;
    for (let round = 0; round < CHAT_FILTER_EVENT_MAX_BATCHES; round += 1) {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM app.chat_filter_events
        WHERE id IN (
          SELECT e.id FROM app.chat_filter_events e
          WHERE e.org_id = ${org.organizationId}
            AND e.created_at_ms < ${cutoff}
            AND (${protectedIds.length === 0}
                 OR NOT EXISTS (
                   SELECT 1 FROM app.thread_metadata tm
                   WHERE tm.thread_id = e.thread_id
                     AND tm.org_id = ${org.organizationId}
                     AND tm.user_id = ANY(${protectedIds})
                 ))
          LIMIT ${BATCH_LIMIT}
        )
        RETURNING id
      `;
      deleted += rows.length;
      if (rows.length < BATCH_LIMIT) return { deleted };
    }
    console.info(
      `[retention] org ${org.organizationId}: chat filter events stopped at ${deleted} deleted this run; the next run carries on`,
    );
    return { deleted };
  });
}

/** The daily entry point: every org with a valid clamped policy sweeps. */
export async function runRetentionCleanup(
  sql: Sql,
): Promise<Record<string, SweepStats & Phase2Stats>> {
  if (isRetentionDisabled()) {
    console.warn('[retention] TALE_RETENTION_DISABLED=true — skipping run');
    return {};
  }
  const orgs = await sql<{ id: string }[]>`
    SELECT org_id AS id FROM app.retention_applied_bounds
  `;
  const results: Record<string, SweepStats & Phase2Stats> = {};
  for (const org of orgs) {
    const stats = await runOrgRetention(sql, org.id);
    if (stats !== null) results[org.id] = stats;
  }
  return results;
}

/**
 * One org's run between its audit rows: `retention.run_started`, the
 * categories (each appending its own destruction row), then the closing
 * row. An org with no valid clamped policy has nothing to run and writes
 * nothing; any failure — reading the policy included — closes the run as
 * failed.
 */
async function runOrgRetention(
  sql: Sql,
  organizationId: string,
): Promise<(SweepStats & Phase2Stats) | null> {
  const run = newRetentionRun(organizationId);
  let stats: SweepStats & Phase2Stats;
  try {
    const policy = await clampedPolicyFor(sql, organizationId);
    if (policy === null) return null;
    const holds = await loadActiveHolds(sql, organizationId);
    await recordRunStarted(sql, run, policy, holds);
    const rowStats = await sweepOrg(sql, policy, holds, run);
    const phase2 = await sweepOrgPhase2(sql, policy, holds, run);
    stats = { ...rowStats, ...phase2 };
  } catch (error) {
    // One org's failure must not starve the rest of the fleet.
    console.error(`[retention] org ${organizationId} sweep failed:`, error);
    await recordRunFinished(sql, run, { error });
    return null;
  }
  await recordRunFinished(sql, run);
  return stats;
}

// ------------------------------------------------------- phase-2 sweeps

interface Phase2Stats {
  documents: number;
  chatHistory: number;
  contacts: number;
  externalConversations: number;
  agentRuns: number;
  automationRuns: number;
  auditLogs: number;
  tempFiles: number;
  sandboxLedgers: number;
}

/** A purge that could not remove every dead surface (corpus rows, bytes).
 * The document row is KEPT so the caller can retry — a delete lane must
 * never report success while content persists. Deliberately not a 4xx: the
 * request was valid; the infrastructure failed. */
export class PurgeIncompleteError extends Error {
  readonly code = 'PURGE_INCOMPLETE';
  readonly failures: ReleaseFailure[];
  constructor(documentId: string, failures: ReleaseFailure[]) {
    super(
      `Purge incomplete for document ${documentId}: ${failures
        .map(
          (failure) => `${failure.ref} (${failure.stage}): ${failure.message}`,
        )
        .join('; ')}`,
    );
    this.name = 'PurgeIncompleteError';
    this.failures = failures;
  }
}

/** Hard-delete one document: corpus entries + blobs first, through the
 * shared refcounted release seam (current ref + `historyFiles` — replaced
 * blobs a sync/replace appended, the 0.4 `eraseDocumentBlobs` contract; a
 * ref another document still holds — a WebDAV COPY twin, a shared history
 * snapshot — is KEPT for the twin), then file rows, dependent knowledge-
 * entry chains, and the row. Throws `PurgeIncompleteError` when a corpus or
 * blob delete fails, WITHOUT touching the app rows — every hard-delete lane
 * funnels here (user delete, folder cascade, REST, retention sweep, erasure
 * cascade, sync prune), and each retries from its own loop: the daily
 * sweep re-selects the row, an erasure lands `partial` and can be re-armed,
 * a user sees the failure instead of a false receipt. Idempotent. Once the
 * row is gone, a ref a twin keeps is re-stamped with its holder's scope:
 * the deleted document may have been that holder (`syncRagRefHolderScopes`,
 * best-effort). */
export async function purgeDocument(
  sql: Sql,
  orgSlug: string | null,
  doc: {
    id: string;
    fileRef: string | null;
    organizationId: string;
    historyFiles?: string[];
  },
): Promise<void> {
  // A null slug means the organization row itself is gone — its corpus and
  // bucket are unaddressable; only the app rows remain to clean up.
  if (orgSlug !== null) {
    const outcome = await releaseRefs(sql, {
      organizationId: doc.organizationId,
      orgSlug,
      refs: [doc.fileRef, ...(doc.historyFiles ?? [])],
      excludeDocumentId: doc.id,
    });
    if (outcome.failures.length > 0) {
      throw new PurgeIncompleteError(doc.id, outcome.failures);
    }
  }
  await sql.begin(async (tx) => {
    await markEntryChainDeletedForDocument(tx, doc.organizationId, doc.id);
    await tx`
      DELETE FROM app.file_metadata WHERE document_id = ${doc.id}
    `;
    await tx`DELETE FROM app.documents WHERE id = ${doc.id}`;
  });
  if (orgSlug !== null && doc.fileRef !== null) {
    await syncRagRefHolderScopes(sql, doc.organizationId, [doc.fileRef]);
  }
}

async function sweepDocuments(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.documentsEnabled !== true) return;
  const days = org.config.documentsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  const protectedIds = [...holds.userMembershipIds];

  // The custodian filter lives in SQL, on every pass: a held creator's rows
  // are never candidates, so they cannot fill the batch. Skipping them in
  // JS after `LIMIT` starved the sweep — once an org held more than a
  // batch of trashed rows, the same held rows were re-selected every night
  // and the unheld rows behind them were never reached. A creator-less row
  // (a synced document) is nobody's to hold: `NULL <> ALL(...)` is NULL,
  // so the IS NULL arm keeps it a candidate.
  const custodianFree = sql`
    (${protectedIds.length === 0}
     OR created_by IS NULL OR created_by <> ALL(${protectedIds}))
  `;

  // Pass A (grace > 0): flip active expired rows into the admin Trash. A
  // document's age is its creation — or its last lifecycle change, when a
  // restore from the Trash stamped one: a restore restarts the retention
  // clock, or the very next sweep re-expires the row the admin just brought
  // back (and, with no grace, hard-deletes it outright). The flip is a door
  // that hides a document, so it retires the knowledge-entry chain the
  // document backs in the same transaction — an expired document's corpus
  // rows go dark at once, and an entry must never stay listed, counted and
  // served to the agent leg for the whole grace window while they are.
  if (graceDays > 0) {
    const expired = await sql.begin(async (tx) => {
      const flipped = await tx<{ id: string; projectId: string | null }[]>`
        UPDATE app.documents SET
          lifecycle_status = 'expired', status_changed_at_ms = ${Date.now()}
        WHERE id IN (
          SELECT id FROM app.documents
          WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
            AND GREATEST(created_at_ms, coalesce(status_changed_at_ms, 0))
                < ${cutoff}
            AND ${custodianFree}
          LIMIT ${BATCH_LIMIT}
        )
        RETURNING id, project_id AS "projectId"
      `;
      await markEntryChainsDeletedForDocuments(
        tx,
        org.organizationId,
        flipped.map((row) => row.id),
      );
      if (flipped.length > 0) {
        // The flip hides rows from every Files list and from a bound folder's
        // task facts — one batch-level hint per family, like every writer.
        await emitDocumentChangeHints(tx, {
          orgId: org.organizationId,
          entityId: null,
          projectId:
            flipped.find((row) => row.projectId !== null)?.projectId ?? null,
        });
      }
      return flipped.length;
    });
    trail.tally.expired += expired;
  }

  // Pass B: hard-delete rows whose grace elapsed (or, no grace, active
  // expired rows directly).
  const passB =
    graceDays > 0
      ? await sql<
          {
            id: string;
            fileRef: string | null;
            historyFiles: string[];
            projectId: string | null;
          }[]
        >`
          SELECT id, file_ref AS "fileRef", history_files AS "historyFiles",
                 project_id AS "projectId"
          FROM app.documents
          WHERE org_id = ${org.organizationId}
            AND lifecycle_status IN ('trashed', 'expired')
            AND status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
            AND ${custodianFree}
          LIMIT ${BATCH_LIMIT}
        `
      : // No grace window: trashed/expired rows (user trash, a project-
        // cascade's 'expired' marks) hard-delete on the next sweep, and
        // active rows past the cutoff go directly. Without the lifecycle
        // arm, grace=0 orgs kept 'expired' documents forever — the project-
        // cascade promise ("the retention pipeline hard-deletes blob + RAG
        // chunks") silently never ran.
        await sql<
          {
            id: string;
            fileRef: string | null;
            historyFiles: string[];
            projectId: string | null;
          }[]
        >`
          SELECT id, file_ref AS "fileRef", history_files AS "historyFiles",
                 project_id AS "projectId"
          FROM app.documents
          WHERE org_id = ${org.organizationId}
            AND ((lifecycle_status IS NULL
                  AND GREATEST(created_at_ms, coalesce(status_changed_at_ms, 0))
                      < ${cutoff})
                 OR lifecycle_status IN ('trashed', 'expired'))
            AND ${custodianFree}
          LIMIT ${BATCH_LIMIT}
        `;
  if (passB.length === 0) return;
  const orgSlug = await resolveOrgSlug(sql, org.organizationId);
  let purgedProjectId: string | null = null;
  for (const doc of passB) {
    try {
      await purgeDocument(sql, orgSlug, {
        id: doc.id,
        fileRef: doc.fileRef,
        organizationId: org.organizationId,
        historyFiles: doc.historyFiles,
      });
    } catch (error) {
      // The row is kept (purgeDocument releases before it deletes), so the
      // next daily run retries; one stuck document must not starve the rest.
      console.warn(`[retention] purge failed for document ${doc.id}:`, error);
      trail.tally.failed += 1;
      continue;
    }
    trail.tally.deleted += 1;
    purgedProjectId ??= doc.projectId;
  }
  if (trail.tally.deleted > 0) {
    // Rows are gone from the Files lists and from a bound folder's task
    // facts — one batch-level hint per family, after the purges committed —
    // and the batch's one destruction row rides the same transaction.
    await sql.begin(async (tx) => {
      await emitDocumentChangeHints(tx, {
        orgId: org.organizationId,
        entityId: null,
        projectId: purgedProjectId,
      });
      await recordDestruction(tx, trail, {
        deleted: trail.tally.deleted,
        failed: trail.tally.failed,
      });
    });
  }
}

/** Purge one CHAT thread and its lineage: messages, generations, feedback,
 * sidecars, deferred sends (FK), then the thread rows. Task-discussion and
 * other non-chat threads never enter (the caller filters by chat_type). */
export async function purgeThreadLineage(
  sql: Sql,
  organizationId: string,
  rootThreadId: string,
): Promise<number> {
  const lineage = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.thread_metadata
    WHERE branch_root_id = ${rootThreadId}
  `;
  const ids = [rootThreadId, ...lineage.map((row) => row.threadId)];
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM app.message_feedback
      WHERE org_id = ${organizationId} AND thread_id IN ${tx(ids)}
    `;
    await tx`DELETE FROM app.generations WHERE thread_id IN ${tx(ids)}`;
    // Voice artifacts die with the conversation (chunk rows + audio blobs).
    for (const threadId of ids) {
      await cascadeDeleteThreadTtsChunks(tx, organizationId, threadId);
    }
    await tx`DELETE FROM app.messages WHERE thread_id IN ${tx(ids)}`;
    await tx`DELETE FROM app.thread_metadata WHERE thread_id IN ${tx(ids)}`;
    await tx`DELETE FROM app.threads WHERE id IN ${tx(ids)}`;
  });
  return ids.length;
}

async function sweepChatHistory(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.chatHistoryEnabled !== true) return;
  const days = org.config.chatHistoryRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  const protectedIds = [...holds.userMembershipIds];

  // Custodian filter in SQL (see sweepDocuments): a held owner's threads
  // are never candidates, so they cannot fill a batch and starve the rest.
  const custodianFree = sql`
    (${protectedIds.length === 0} OR tm.user_id <> ALL(${protectedIds}))
  `;

  // Pass A (grace > 0): expire active chat threads past the cutoff — they
  // land in the admin Trash for the grace window. A thread's age is its
  // last activity — or its last lifecycle change, when a restore from the
  // Trash stamped one: the restore restarts the retention clock, or the
  // next sweep re-expires the thread the admin just brought back.
  if (graceDays > 0) {
    const candidates = await sql<{ threadId: string }[]>`
      SELECT tm.thread_id AS "threadId"
      FROM app.thread_metadata tm
      JOIN app.threads t ON t.id = tm.thread_id
      WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
        AND tm.status = 'active'
        AND GREATEST(t.updated_at_ms, coalesce(tm.status_changed_at_ms, 0))
            < ${cutoff}
        AND ${custodianFree}
      LIMIT ${BATCH_LIMIT}
    `;
    for (const thread of candidates) {
      await sql`
        UPDATE app.thread_metadata SET
          status = 'expired', status_changed_at_ms = ${Date.now()}
        WHERE thread_id = ${thread.threadId}
      `;
      trail.tally.expired += 1;
    }
  }

  // Pass B: purge trashed/expired chat threads past the grace (or, no
  // grace, active ones past the cutoff). Only lineage ROOTS drive the walk
  // — hidden siblings travel with their root.
  const passB =
    graceDays > 0
      ? await sql<{ threadId: string }[]>`
          SELECT tm.thread_id AS "threadId"
          FROM app.thread_metadata tm
          WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
            AND tm.status IN ('trashed', 'expired')
            AND tm.branch_root_id IS NULL
            AND tm.status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
            AND ${custodianFree}
          LIMIT ${BATCH_LIMIT}
        `
      : await sql<{ threadId: string }[]>`
          SELECT tm.thread_id AS "threadId"
          FROM app.thread_metadata tm
          JOIN app.threads t ON t.id = tm.thread_id
          WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
            AND tm.branch_root_id IS NULL
            AND ((tm.status = 'active'
                  AND GREATEST(t.updated_at_ms,
                               coalesce(tm.status_changed_at_ms, 0))
                      < ${cutoff})
                 OR tm.status IN ('trashed', 'expired'))
            AND ${custodianFree}
          LIMIT ${BATCH_LIMIT}
        `;
  for (const thread of passB) {
    const purged = await purgeThreadLineage(
      sql,
      org.organizationId,
      thread.threadId,
    );
    trail.tally.deleted += purged;
  }
  // Each lineage was purged in a transaction of its own (its voice blobs go
  // inside it); the batch's one row follows them.
  await recordPurgedBatch(sql, trail, { deleted: trail.tally.deleted });
}

async function sweepContacts(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.contactsEnabled !== true) return;
  const days = org.config.contactsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  if (holds.orgHeld) return;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  if (graceDays > 0) {
    const flipped = await sql<{ id: string }[]>`
      UPDATE app.contacts SET
        lifecycle_status = 'expired', status_changed_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()}
      WHERE id IN (
        SELECT id FROM app.contacts
        WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
          AND updated_at_ms < ${cutoff}
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    trail.tally.expired += flipped.length;
  }
  await destroyInTx(sql, trail, async (tx) => {
    const removed =
      graceDays > 0
        ? await tx<{ id: string }[]>`
            DELETE FROM app.contacts
            WHERE id IN (
              SELECT id FROM app.contacts
              WHERE org_id = ${org.organizationId}
                AND lifecycle_status IN ('trashed', 'expired')
                AND status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
              LIMIT ${BATCH_LIMIT}
            )
            RETURNING id
          `
        : await tx<{ id: string }[]>`
            DELETE FROM app.contacts
            WHERE id IN (
              SELECT id FROM app.contacts
              WHERE org_id = ${org.organizationId}
                AND (lifecycle_status IN ('trashed', 'expired')
                     OR (lifecycle_status IS NULL
                         AND updated_at_ms < ${cutoff}))
              LIMIT ${BATCH_LIMIT}
            )
            RETURNING id
          `;
    return { deleted: removed.length };
  });
}

/**
 * The `externalConversations` category — the Inbox's own payload, and the
 * heaviest correspondent-PII surface retention governs:
 * `app.conversation_messages.content` is NOT NULL text holding the inbound
 * and outbound email BODIES, plus a `metadata` jsonb of envelope detail.
 *
 * Ages by `last_message_at_ms` (the 0.4 `lastMessageAt` window, served by
 * `conversations_org_last_message`). A conversation that never received a
 * message has no activity timestamp to age against and is intentionally NOT
 * a candidate — the 0.4 index range said the same, and `NULL < cutoff` is
 * already false in SQL, so the rule costs nothing to keep. A restore from
 * the Trash stamps `status_changed_at_ms`, and that stamp restarts the
 * retention clock (spelled as a second `<` rather than `GREATEST`, which
 * ignores NULLs and would turn the never-messaged row into a candidate) —
 * the same rule the document and chat sweeps follow.
 *
 * Message rows ride the parent's `ON DELETE CASCADE` (migration 0036).
 * Stored mail attachments do NOT: `app.file_metadata.conversation_id`
 * (migration 0037) is a plain column with no FK, and the mail lane stamps
 * `source` with the CONNECTOR slug, so `sweepTempFiles` — which only takes
 * `source` 'user'/'agent' — never reaches them. Without the cascade below,
 * deleting the email body would leave its attachment bytes live forever
 * behind a dangling pointer, which is the opposite of the promise the
 * window makes. A file promoted into a Document is left alone: the
 * `documents` category owns that lifecycle, the same `document_id IS NULL`
 * guard `sweepTempFiles` uses.
 *
 * Nor do the corpus copies of the inbound email bodies (`rag.index_message`,
 * keyed by `msg:` ref): they live in the knowledge database, so their
 * release is queued in the transaction that deletes the conversations — the
 * posture `deleteConversation` takes. The job runs once the rows are gone
 * (pg-boss retries it, the daily corpus reconcile finishes one that gives
 * up, and the retrievable filter refuses a deleted message's rows
 * meanwhile), so a knowledge database that cannot be reached never holds
 * the window back, and a body indexed late — by a job in flight while the
 * sweep ran — is released by it too.
 */
async function sweepExternalConversations(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.externalConversationsEnabled !== true) return;
  const days = org.config.externalConversationsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  if (holds.orgHeld) return;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  if (graceDays > 0) {
    const flipped = await sql<{ id: string }[]>`
      UPDATE app.conversations SET
        lifecycle_status = 'expired', status_changed_at_ms = ${Date.now()}
      WHERE id IN (
        SELECT id FROM app.conversations
        WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
          AND last_message_at_ms < ${cutoff}
          AND coalesce(status_changed_at_ms, 0) < ${cutoff}
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    trail.tally.expired += flipped.length;
  }
  const doomed =
    graceDays > 0
      ? await sql<{ id: string }[]>`
          SELECT id FROM app.conversations
          WHERE org_id = ${org.organizationId}
            AND lifecycle_status IN ('trashed', 'expired')
            AND status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
          LIMIT ${BATCH_LIMIT}
        `
      : await sql<{ id: string }[]>`
          SELECT id FROM app.conversations
          WHERE org_id = ${org.organizationId}
            AND (lifecycle_status IN ('trashed', 'expired')
                 OR (lifecycle_status IS NULL
                     AND last_message_at_ms < ${cutoff}
                     AND coalesce(status_changed_at_ms, 0) < ${cutoff}))
          LIMIT ${BATCH_LIMIT}
        `;
  if (doomed.length === 0) return;
  const doomedIds = doomed.map((row) => row.id);
  const attachments = await sql<
    { id: string; storageRef: string; conversationId: string }[]
  >`
    SELECT id, storage_ref AS "storageRef",
           conversation_id AS "conversationId"
    FROM app.file_metadata
    WHERE org_id = ${org.organizationId}
      AND conversation_id IN ${sql(doomedIds)}
      AND document_id IS NULL
  `;
  const stranded = new Set<string>();
  let attachmentsDeleted = 0;
  if (attachments.length > 0) {
    const orgSlug = await resolveOrgSlug(sql, org.organizationId);
    for (const file of attachments) {
      if (orgSlug !== null) {
        // The same refcounted release `sweepTempFiles` uses: an indexed
        // attachment's corpus rows die with it, a blob another holder still
        // references survives, and a failed delete KEEPS the row so the next
        // sweep retries rather than leaking the bytes forever.
        const outcome = await releaseRefs(sql, {
          organizationId: org.organizationId,
          orgSlug,
          refs: [file.storageRef],
          excludeFileMetadataId: file.id,
        });
        if (outcome.failures.length > 0) {
          console.warn(
            `[retention] conversation-attachment release failed for ${file.id} — keeping the row and its conversation for the next sweep:`,
            outcome.failures,
          );
          stranded.add(file.conversationId);
          continue;
        }
      }
      await sql`DELETE FROM app.file_metadata WHERE id = ${file.id}`;
      attachmentsDeleted += 1;
      trail.tally.deleted += 1;
    }
  }
  trail.tally.failed += stranded.size;
  // A conversation whose attachment could not be released stays too: deleting
  // the parent would orphan the file row behind a dangling pointer, which is
  // the failure this cascade exists to prevent.
  const deletable = doomedIds.filter((id) => !stranded.has(id));
  if (deletable.length === 0 && attachmentsDeleted === 0) return;
  // The attachments went one by one with their bytes (see the audit-trail
  // note); the conversations — and with them every email body — go in the
  // transaction that writes the category's row.
  const conversations = await sql.begin(async (tx) => {
    // Read before the rows go: the refs are the messages' ids.
    const bodyRefs = await indexedMessageRefsOf(
      tx,
      org.organizationId,
      deletable,
    );
    const removed =
      deletable.length === 0
        ? []
        : await tx<{ id: string }[]>`
            DELETE FROM app.conversations WHERE id IN ${tx(deletable)}
            RETURNING id
          `;
    await queueMessageRefRelease(tx, org.organizationId, bodyRefs);
    await recordDestruction(tx, trail, {
      deleted: removed.length + attachmentsDeleted,
      counts: {
        conversations: removed.length,
        attachments: attachmentsDeleted,
      },
      failed: stranded.size,
    });
    return removed.length;
  });
  trail.tally.deleted += conversations;
}

async function sweepAgentRuns(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.agentRunsEnabled !== true) return;
  const days = org.config.agentRunsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoff =
    Date.now() - (days + (org.config.deletionGraceDays ?? 0)) * DAY_MS;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      DELETE FROM app.project_agent_runs
      WHERE id IN (
        SELECT id FROM app.project_agent_runs
        WHERE org_id = ${org.organizationId}
          AND status IN ('settled', 'failed', 'cancelled')
          AND settled_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR started_by <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    return { deleted: rows.length };
  });
}

/**
 * The `workflowLog` category's automation runs — the operator reads one
 * question ("how long do we keep a record of what automations did"), so this
 * shares that flag and window with the workflow log rather than inventing a
 * category.
 *
 * Only TERMINAL runs are candidates. A `waiting` run is parked on a human
 * decision and may sit for weeks; a `running` one is mid-flight — age alone
 * must never make either a candidate, or the sweep destroys live work
 * instead of an old record. `app.automation_runs` carries no user column, so
 * the org-wide hold (checked by the caller before any category runs) is the
 * whole custodian story; removing one subject's runs is erasure's job.
 */
async function sweepAutomationRuns(
  sql: Sql,
  org: OrgPolicy,
  trail: CategoryTrail,
): Promise<void> {
  if (org.config.workflowLogEnabled !== true) return;
  const days = org.config.workflowLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return;
  const cutoff =
    Date.now() - (days + (org.config.deletionGraceDays ?? 0)) * DAY_MS;
  await destroyInTx(sql, trail, async (tx) => {
    await markAutomationWriterInTx(tx);
    // The delete clears a purged run from the trigger that names it
    // (`last_run_id`, `last_failed_run_id`: `ON DELETE SET NULL`), a write
    // of that trigger row, so when a trigger names a run of the batch the
    // organization's audit chain is taken before the delete — and after the
    // runs' own rows — in the order a landing run takes them
    // (`automations/trigger-failures.ts`). When none does, the delete writes
    // no trigger row and the chain waits for the category's audit row:
    // taken here, it would queue every audit writer of the organization
    // behind a delete of up to a thousand runs. The batch is terminal and
    // locked, and a trigger only ever names a run it is starting or one
    // that is landing, so none can come to name one of these before the
    // delete.
    const batch = await tx<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE org_id = ${org.organizationId}
        AND status IN ('success', 'failed', 'cancelled')
        AND coalesce(finished_at_ms, started_at_ms) < ${cutoff}
      LIMIT ${BATCH_LIMIT}
      FOR UPDATE
    `;
    if (batch.length === 0) return { deleted: 0 };
    const ids = batch.map((run) => run.id);
    const named = await tx<{ named: number }[]>`
      SELECT 1 AS named FROM app.automation_triggers
      WHERE org_id = ${org.organizationId}
        AND (last_run_id = ANY(${ids}::text[])
          OR last_failed_run_id = ANY(${ids}::text[]))
      LIMIT 1
    `;
    if (named.length > 0) await lockAuditChain(tx, org.organizationId);
    const rows = await tx<{ id: string }[]>`
      DELETE FROM app.automation_runs
      WHERE id = ANY(${ids}::text[])
      RETURNING id
    `;
    return { deleted: rows.length };
  });
}

/** The audit-log sweep's cutoff for one clamped policy: rows with `ts`
 * below it are reap candidates; null when the category is off. */
function auditLogCutoffFor(config: RetentionPolicyConfig): number | null {
  if (config.auditLogEnabled !== true) return null;
  const days = config.auditLogRetentionDays;
  if (typeof days !== 'number' || days <= 0 || !Number.isFinite(days)) {
    return null;
  }
  return Date.now() - days * DAY_MS;
}

/**
 * The oldest audit `ts` the org's sweep would still keep right now — the
 * same clamped, cooldown-overlaid policy `sweepAuditLogs` enforces — or
 * null when nothing legitimately deletes the org's audit rows (category
 * off, no valid policy, bounds never applied). The scheduled integrity walk
 * uses it to tell a resume anchor the sweep reaped (re-anchor) from a row
 * that vanished inside the window (a break).
 */
export async function auditLogRetentionCutoff(
  sql: Sql,
  organizationId: string,
): Promise<number | null> {
  const policy = await clampedPolicyFor(sql, organizationId);
  return policy === null ? null : auditLogCutoffFor(policy.config);
}

/**
 * Audit logs are PREFIX-ONLY: the hash chain anchors on the oldest
 * remaining row's stored `previous_hash`, so a mid-chain hole would break
 * verification. The walk deletes oldest-first and STOPS at the first row
 * inside the window that must be preserved — a custodian-held user's row,
 * whether they ACTED (actor) or were acted UPON (`resource_type = 'user'`,
 * the same two-sided definition the erasure scrub uses for a subject's
 * rows) — the spoliation duty wins over the retention window. The prefix
 * goes in one transaction with its destruction row, and the row records the
 * cut: the hash of the newest row removed is the `previous_hash` the
 * surviving chain now anchors on.
 */
async function sweepAuditLogs(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  const cutoff = auditLogCutoffFor(org.config);
  if (cutoff === null) return;
  // Refuse to delete the very table that records why the hold exists.
  if (holds.orgHeld) return;
  await destroyInTx(sql, trail, async (tx) => {
    const candidates = await tx<
      {
        id: string;
        actorId: string | null;
        resourceType: string;
        resourceId: string | null;
        ts: number;
        integrityHash: string;
      }[]
    >`
      SELECT id, actor_id AS "actorId", resource_type AS "resourceType",
             resource_id AS "resourceId", ts::float8 AS ts,
             integrity_hash AS "integrityHash"
      FROM app.audit_logs
      WHERE org_id = ${org.organizationId} AND ts < ${cutoff}
      ORDER BY ts ASC, id ASC
      LIMIT ${BATCH_LIMIT}
    `;
    const prefix: string[] = [];
    let lastDeletedHash: string | null = null;
    for (const row of candidates) {
      const heldActor =
        row.actorId !== null && holds.userMembershipIds.has(row.actorId);
      const heldSubject =
        row.resourceType === 'user' &&
        row.resourceId !== null &&
        holds.userMembershipIds.has(row.resourceId);
      if (heldActor || heldSubject) {
        break; // preserve from here on — no mid-chain holes
      }
      prefix.push(row.id);
      lastDeletedHash = row.integrityHash;
    }
    if (prefix.length === 0) return { deleted: 0 };
    const removed = await tx<{ id: string }[]>`
      DELETE FROM app.audit_logs WHERE id IN ${tx(prefix)} RETURNING id
    `;
    return {
      deleted: removed.length,
      detail: { olderThan: cutoff, lastDeletedHash },
    };
  });
}

/**
 * The sandbox provenance ledgers — `app.sandbox_tool_calls` (every tool and
 * connector call a container made, with the acting user) and
 * `app.sandbox_credential_access` (every brokered credential grant). Both
 * are written as audit trails, and the run ledger copies what a settle
 * needs into `app.audit_logs` (itself under this window), so the raw rows
 * ride the audit-log window rather than inventing a category; before this
 * sweep they grew without bound, user id attached. The window's floor (a
 * year) sits far above any live turn's settle read, so age alone is safe.
 *
 * Plain bounded row deletes — the hash chain lives on the audit log, not
 * here. A held actor's tool calls are skipped in SQL like the usage
 * ledger's (a user-less row stays a candidate); the credential table has
 * no user column, so the org-wide hold (the caller's guard) is its whole
 * custodian story.
 */
async function sweepSandboxLedgers(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  const cutoff = auditLogCutoffFor(org.config);
  if (cutoff === null) return;
  const protectedIds = [...holds.userMembershipIds];
  await destroyInTx(sql, trail, async (tx) => {
    const toolCalls = await tx<{ id: string }[]>`
      DELETE FROM app.sandbox_tool_calls
      WHERE id IN (
        SELECT id FROM app.sandbox_tool_calls
        WHERE org_id = ${org.organizationId}
          AND created_at_ms < ${cutoff}
          AND (${protectedIds.length === 0}
               OR user_id IS NULL OR user_id <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    const credentialAccess = await tx<{ id: string }[]>`
      DELETE FROM app.sandbox_credential_access
      WHERE id IN (
        SELECT id FROM app.sandbox_credential_access
        WHERE org_id = ${org.organizationId}
          AND fetched_at_ms < ${cutoff}
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    return {
      deleted: toolCalls.length + credentialAccess.length,
      counts: {
        toolCalls: toolCalls.length,
        credentialAccess: credentialAccess.length,
      },
    };
  });
}

/** The loose user and agent uploads past their hour windows: one row for
 * both sources, once both batches are through. */
async function sweepTempFiles(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<void> {
  const userTemp = await sweepTempFileSource(sql, org, 'user', holds, trail);
  const agentTemp = await sweepTempFileSource(sql, org, 'agent', holds, trail);
  // Each file was released and deleted on its own (see the audit-trail
  // note); the category's one row follows both batches.
  await recordPurgedBatch(sql, trail, {
    deleted: userTemp + agentTemp,
    counts: { userTemp, agentTemp },
    failed: trail.tally.failed,
  });
}

async function sweepTempFileSource(
  sql: Sql,
  org: OrgPolicy,
  source: 'user' | 'agent',
  holds: ActiveHolds,
  trail: CategoryTrail,
): Promise<number> {
  const enabled =
    source === 'user'
      ? org.config.userTempEnabled
      : org.config.agentTempEnabled;
  if (enabled !== true) return 0;
  const rawHours =
    source === 'user'
      ? org.config.userTempRetentionHours
      : org.config.agentTempRetentionHours;
  const hours = rawHours ?? 24;
  // A 0/negative value must read as OFF, never as delete-everything-now.
  if (typeof hours !== 'number' || hours <= 0 || !Number.isFinite(hours)) {
    return 0;
  }
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const protectedIds = [...holds.userMembershipIds];
  const rows = await sql<{ id: string; storageRef: string }[]>`
    SELECT id, storage_ref AS "storageRef" FROM app.file_metadata
    WHERE org_id = ${org.organizationId} AND source = ${source}
      AND document_id IS NULL AND created_at_ms < ${cutoff}
      AND (${protectedIds.length === 0}
           OR uploaded_by IS NULL OR uploaded_by <> ALL(${protectedIds}))
    LIMIT ${BATCH_LIMIT}
  `;
  if (rows.length === 0) return 0;
  const orgSlug = await resolveOrgSlug(sql, org.organizationId);
  let removed = 0;
  for (const row of rows) {
    if (orgSlug !== null) {
      // Refcounted release: an indexed temp/thread file's corpus rows die
      // with it, a shared blob survives for its other holders, and a failed
      // delete KEEPS the row so the next daily sweep retries — deleting the
      // row after a swallowed blob failure leaked the bytes forever.
      const outcome = await releaseRefs(sql, {
        organizationId: org.organizationId,
        orgSlug,
        refs: [row.storageRef],
        excludeFileMetadataId: row.id,
      });
      if (outcome.failures.length > 0) {
        console.warn(
          `[retention] temp-file release failed for ${row.id} — keeping the row for the next sweep:`,
          outcome.failures,
        );
        trail.tally.failed += 1;
        continue;
      }
    }
    await sql`DELETE FROM app.file_metadata WHERE id = ${row.id}`;
    trail.tally.deleted += 1;
    removed += 1;
  }
  return removed;
}

/** The phase-2 categories, run after the row-level ones per org. Swept on
 * its own (outside `runRetentionCleanup`), the destruction rows still land,
 * under a run that writes no start or end row. */
export async function sweepOrgPhase2(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
  run: RetentionRun = newRetentionRun(org.organizationId),
): Promise<Phase2Stats> {
  const stats: Phase2Stats = {
    documents: 0,
    chatHistory: 0,
    contacts: 0,
    externalConversations: 0,
    agentRuns: 0,
    automationRuns: 0,
    auditLogs: 0,
    tempFiles: 0,
    sandboxLedgers: 0,
  };
  if (holds.orgHeld) return stats;
  const categories: [
    keyof Phase2Stats,
    (trail: CategoryTrail) => Promise<void>,
  ][] = [
    ['documents', (trail) => sweepDocuments(sql, org, holds, trail)],
    ['chatHistory', (trail) => sweepChatHistory(sql, org, holds, trail)],
    ['contacts', (trail) => sweepContacts(sql, org, holds, trail)],
    [
      'externalConversations',
      (trail) => sweepExternalConversations(sql, org, holds, trail),
    ],
    ['agentRuns', (trail) => sweepAgentRuns(sql, org, holds, trail)],
    ['automationRuns', (trail) => sweepAutomationRuns(sql, org, trail)],
    ['auditLogs', (trail) => sweepAuditLogs(sql, org, holds, trail)],
    ['tempFiles', (trail) => sweepTempFiles(sql, org, holds, trail)],
    ['sandboxLedgers', (trail) => sweepSandboxLedgers(sql, org, holds, trail)],
  ];
  for (const [category, sweep] of categories) {
    stats[category] = await sweepCategory(run, category, sweep);
  }
  return stats;
}
