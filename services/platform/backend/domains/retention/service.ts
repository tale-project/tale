import type { Sql } from 'postgres';

import type { RetentionPolicyConfig } from '../../../lib/shared/schemas/governance.ts';
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
import { createAuditLog } from '../audit_logs/service.ts';
import { releaseRefs, type ReleaseFailure } from '../knowledge/release.ts';
import { loadActiveHolds, type ActiveHolds } from '../legal_holds/service.ts';
import { cascadeDeleteThreadTtsChunks } from '../tts/service.ts';

/**
 * The retention framework — the 0.5 twin of
 * `convex/governance/retention_cleanup.ts` (phase 1): the APPLIED-BOUNDS
 * snapshot (file × env tightening, reused pure `retention_floors`;
 * operator edits take effect only when an admin applies), the daily
 * cleanup dispatcher (per-org: policy file clamped to the applied row,
 * holds pre-fetched once), and the first category sweeps — usage ledger,
 * message feedback, and both notification tables.
 *
 * DELIBERATE phase-1 simplification: the 0.4 two-pass grace model (mark
 * `expired` → admin Trash → physical delete after grace) collapses to a
 * direct delete past `retention + grace` for these row-level categories —
 * the same end state; the visible-trash pass matters for THREADS and
 * DOCUMENTS, which ride the next phase with their own lifecycle columns.
 * `TALE_RETENTION_DISABLED=true` is the operator kill-switch.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 1_000;

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
 * is seeded from the catalog at create; no cross-org fallback). */
export async function loadOrgRetentionConfig(orgSlug: string) {
  const path = await import('node:path');
  const dir = path.join(getConfigRoot('retention'), orgSlug, 'governance');
  const result = await readDomainConfigFile(
    dir,
    'retention',
    MAX_RETENTION_FILE_BYTES,
    (data) => retentionDefaultsConfigSchema.parse(data),
  );
  return result.ok ? result.data : null;
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

interface SweepStats {
  usageLedger: number;
  messageFeedback: number;
  notifications: number;
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
): Promise<SweepStats> {
  const stats: SweepStats = {
    usageLedger: 0,
    messageFeedback: 0,
    notifications: 0,
  };
  if (holds.orgHeld) {
    console.info(
      `[retention] org ${org.organizationId} on legal hold — skipping all categories`,
    );
    return stats;
  }
  const graceDays = org.config.deletionGraceDays ?? 0;
  const protectedIds = [...holds.userMembershipIds];

  if (org.config.usageLedgerEnabled === true) {
    const cutoff = cutoffFor(org.config.usageLedgerRetentionDays, graceDays);
    if (cutoff !== null) {
      const rows = await sql<{ id: string }[]>`
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
      stats.usageLedger = rows.length;
    }
  }

  if (org.config.messageFeedbackEnabled === true) {
    const cutoff = cutoffFor(
      org.config.messageFeedbackRetentionDays,
      graceDays,
    );
    if (cutoff !== null) {
      const rows = await sql<{ id: string }[]>`
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
      stats.messageFeedback = rows.length;
    }
  }

  if (org.config.notificationsEnabled === true) {
    const cutoff = cutoffFor(org.config.notificationsRetentionDays, graceDays);
    if (cutoff !== null) {
      const orgRows = await sql<{ id: string }[]>`
        DELETE FROM app.notifications
        WHERE id IN (
          SELECT id FROM app.notifications
          WHERE org_id = ${org.organizationId}
            AND created_at_ms < ${cutoff}
          LIMIT ${BATCH_LIMIT}
        )
        RETURNING id
      `;
      const userRows = await sql<{ id: string }[]>`
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
      stats.notifications = orgRows.length + userRows.length;
    }
  }

  return stats;
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
    try {
      const policy = await clampedPolicyFor(sql, org.id);
      if (policy === null) continue;
      const holds = await loadActiveHolds(sql, org.id);
      const rowStats = await sweepOrg(sql, policy, holds);
      const phase2 = await sweepOrgPhase2(sql, policy, holds);
      results[org.id] = { ...rowStats, ...phase2 };
    } catch (error) {
      // One org's failure must not starve the rest of the fleet.
      console.error(`[retention] org ${org.id} sweep failed:`, error);
    }
  }
  return results;
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
 * a user sees the failure instead of a false receipt. Idempotent. */
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
    await tx`
      UPDATE app.knowledge_entries SET deleted_at_ms = ${Date.now()}
      WHERE document_id = ${doc.id} AND deleted_at_ms IS NULL
    `;
    await tx`
      DELETE FROM app.file_metadata WHERE document_id = ${doc.id}
    `;
    await tx`DELETE FROM app.documents WHERE id = ${doc.id}`;
  });
}

async function sweepDocuments(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
): Promise<number> {
  if (org.config.documentsEnabled !== true) return 0;
  const days = org.config.documentsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  const protectedIds = [...holds.userMembershipIds];
  let processed = 0;

  // Pass A (grace > 0): flip active expired rows into the admin Trash. A
  // document's age is its creation — or its last lifecycle change, when a
  // restore from the Trash stamped one: a restore restarts the retention
  // clock, or the very next sweep re-expires the row the admin just brought
  // back (and, with no grace, hard-deletes it outright).
  if (graceDays > 0) {
    const flipped = await sql<{ id: string }[]>`
      UPDATE app.documents SET
        lifecycle_status = 'expired', status_changed_at_ms = ${Date.now()}
      WHERE id IN (
        SELECT id FROM app.documents
        WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
          AND GREATEST(created_at_ms, coalesce(status_changed_at_ms, 0))
              < ${cutoff}
          AND (${protectedIds.length === 0}
               OR created_by <> ALL(${protectedIds}))
        LIMIT ${BATCH_LIMIT}
      )
      RETURNING id
    `;
    processed += flipped.length;
  }

  // Pass B: hard-delete rows whose grace elapsed (or, no grace, active
  // expired rows directly).
  const passB =
    graceDays > 0
      ? await sql<
          {
            id: string;
            fileRef: string | null;
            createdBy: string | null;
            historyFiles: string[];
          }[]
        >`
          SELECT id, file_ref AS "fileRef", created_by AS "createdBy",
                 history_files AS "historyFiles"
          FROM app.documents
          WHERE org_id = ${org.organizationId}
            AND lifecycle_status IN ('trashed', 'expired')
            AND status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
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
            createdBy: string | null;
            historyFiles: string[];
          }[]
        >`
          SELECT id, file_ref AS "fileRef", created_by AS "createdBy",
                 history_files AS "historyFiles"
          FROM app.documents
          WHERE org_id = ${org.organizationId}
            AND ((lifecycle_status IS NULL
                  AND GREATEST(created_at_ms, coalesce(status_changed_at_ms, 0))
                      < ${cutoff})
                 OR lifecycle_status IN ('trashed', 'expired'))
          LIMIT ${BATCH_LIMIT}
        `;
  if (passB.length === 0) return processed;
  const orgSlug = await resolveOrgSlug(sql, org.organizationId);
  for (const doc of passB) {
    if (doc.createdBy !== null && holds.userMembershipIds.has(doc.createdBy)) {
      continue;
    }
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
      continue;
    }
    processed += 1;
  }
  return processed;
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
): Promise<number> {
  if (org.config.chatHistoryEnabled !== true) return 0;
  const days = org.config.chatHistoryRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  let processed = 0;

  // Pass A (grace > 0): expire active chat threads past the cutoff — they
  // land in the admin Trash for the grace window. A thread's age is its
  // last activity — or its last lifecycle change, when a restore from the
  // Trash stamped one: the restore restarts the retention clock, or the
  // next sweep re-expires the thread the admin just brought back.
  if (graceDays > 0) {
    const candidates = await sql<{ threadId: string; userId: string }[]>`
      SELECT tm.thread_id AS "threadId", tm.user_id AS "userId"
      FROM app.thread_metadata tm
      JOIN app.threads t ON t.id = tm.thread_id
      WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
        AND tm.status = 'active'
        AND GREATEST(t.updated_at_ms, coalesce(tm.status_changed_at_ms, 0))
            < ${cutoff}
      LIMIT ${BATCH_LIMIT}
    `;
    for (const thread of candidates) {
      if (holds.userMembershipIds.has(thread.userId)) continue;
      await sql`
        UPDATE app.thread_metadata SET
          status = 'expired', status_changed_at_ms = ${Date.now()}
        WHERE thread_id = ${thread.threadId}
      `;
      processed += 1;
    }
  }

  // Pass B: purge trashed/expired chat threads past the grace (or, no
  // grace, active ones past the cutoff). Only lineage ROOTS drive the walk
  // — hidden siblings travel with their root.
  const passB =
    graceDays > 0
      ? await sql<{ threadId: string; userId: string }[]>`
          SELECT tm.thread_id AS "threadId", tm.user_id AS "userId"
          FROM app.thread_metadata tm
          WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
            AND tm.status IN ('trashed', 'expired')
            AND tm.branch_root_id IS NULL
            AND tm.status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
          LIMIT ${BATCH_LIMIT}
        `
      : await sql<{ threadId: string; userId: string }[]>`
          SELECT tm.thread_id AS "threadId", tm.user_id AS "userId"
          FROM app.thread_metadata tm
          JOIN app.threads t ON t.id = tm.thread_id
          WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
            AND tm.branch_root_id IS NULL
            AND ((tm.status = 'active'
                  AND GREATEST(t.updated_at_ms,
                               coalesce(tm.status_changed_at_ms, 0))
                      < ${cutoff})
                 OR tm.status IN ('trashed', 'expired'))
          LIMIT ${BATCH_LIMIT}
        `;
  for (const thread of passB) {
    if (holds.userMembershipIds.has(thread.userId)) continue;
    processed += await purgeThreadLineage(
      sql,
      org.organizationId,
      thread.threadId,
    );
  }
  return processed;
}

async function sweepContacts(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
): Promise<number> {
  if (org.config.contactsEnabled !== true) return 0;
  const days = org.config.contactsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) return 0;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  let processed = 0;
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
    processed += flipped.length;
  }
  const removed =
    graceDays > 0
      ? await sql<{ id: string }[]>`
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
      : await sql<{ id: string }[]>`
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
  return processed + removed.length;
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
 */
async function sweepExternalConversations(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
): Promise<number> {
  if (org.config.externalConversationsEnabled !== true) return 0;
  const days = org.config.externalConversationsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  if (holds.orgHeld) return 0;
  const cutoff = Date.now() - days * DAY_MS;
  const graceDays = org.config.deletionGraceDays ?? 0;
  let processed = 0;
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
    processed += flipped.length;
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
  if (doomed.length === 0) return processed;
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
    }
  }
  // A conversation whose attachment could not be released stays too: deleting
  // the parent would orphan the file row behind a dangling pointer, which is
  // the failure this cascade exists to prevent.
  const deletable = doomedIds.filter((id) => !stranded.has(id));
  if (deletable.length === 0) return processed;
  const removed = await sql<{ id: string }[]>`
    DELETE FROM app.conversations WHERE id IN ${sql(deletable)} RETURNING id
  `;
  return processed + removed.length;
}

async function sweepAgentRuns(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
): Promise<number> {
  if (org.config.agentRunsEnabled !== true) return 0;
  const days = org.config.agentRunsRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  const cutoff =
    Date.now() - (days + (org.config.deletionGraceDays ?? 0)) * DAY_MS;
  const protectedIds = [...holds.userMembershipIds];
  const rows = await sql<{ id: string }[]>`
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
  return rows.length;
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
async function sweepAutomationRuns(sql: Sql, org: OrgPolicy): Promise<number> {
  if (org.config.workflowLogEnabled !== true) return 0;
  const days = org.config.workflowLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  const cutoff =
    Date.now() - (days + (org.config.deletionGraceDays ?? 0)) * DAY_MS;
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app.automation_runs
    WHERE id IN (
      SELECT id FROM app.automation_runs
      WHERE org_id = ${org.organizationId}
        AND status IN ('success', 'failed', 'cancelled')
        AND coalesce(finished_at_ms, started_at_ms) < ${cutoff}
      LIMIT ${BATCH_LIMIT}
    )
    RETURNING id
  `;
  return rows.length;
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
 * inside the window that must be preserved (a custodian-held actor) — the
 * spoliation duty wins over the retention window.
 */
async function sweepAuditLogs(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
): Promise<number> {
  const cutoff = auditLogCutoffFor(org.config);
  if (cutoff === null) return 0;
  // Refuse to delete the very table that records why the hold exists.
  if (holds.orgHeld) return 0;
  const candidates = await sql<
    { id: string; actorId: string | null; ts: number }[]
  >`
    SELECT id, actor_id AS "actorId", ts::float8 AS ts
    FROM app.audit_logs
    WHERE org_id = ${org.organizationId} AND ts < ${cutoff}
    ORDER BY ts ASC, id ASC
    LIMIT ${BATCH_LIMIT}
  `;
  const prefix: string[] = [];
  for (const row of candidates) {
    if (row.actorId !== null && holds.userMembershipIds.has(row.actorId)) {
      break; // preserve from here on — no mid-chain holes
    }
    prefix.push(row.id);
  }
  if (prefix.length === 0) return 0;
  const removed = await sql<{ id: string }[]>`
    DELETE FROM app.audit_logs WHERE id IN ${sql(prefix)} RETURNING id
  `;
  return removed.length;
}

async function sweepTempFiles(
  sql: Sql,
  org: OrgPolicy,
  source: 'user' | 'agent',
  holds: ActiveHolds,
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
        continue;
      }
    }
    await sql`DELETE FROM app.file_metadata WHERE id = ${row.id}`;
    removed += 1;
  }
  return removed;
}

/** The phase-2 categories, run after the row-level ones per org. */
export async function sweepOrgPhase2(
  sql: Sql,
  org: OrgPolicy,
  holds: ActiveHolds,
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
  };
  if (holds.orgHeld) return stats;
  stats.documents = await sweepDocuments(sql, org, holds);
  stats.chatHistory = await sweepChatHistory(sql, org, holds);
  stats.contacts = await sweepContacts(sql, org, holds);
  stats.externalConversations = await sweepExternalConversations(
    sql,
    org,
    holds,
  );
  stats.agentRuns = await sweepAgentRuns(sql, org, holds);
  stats.automationRuns = await sweepAutomationRuns(sql, org);
  stats.auditLogs = await sweepAuditLogs(sql, org, holds);
  stats.tempFiles =
    (await sweepTempFiles(sql, org, 'user', holds)) +
    (await sweepTempFiles(sql, org, 'agent', holds));
  return stats;
}
