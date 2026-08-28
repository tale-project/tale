import type { Sql } from 'postgres';

import {
  applyEnvTighteningAll,
  clampConfigToBounds,
  isRetentionDisabled,
  type EffectiveBoundDef,
} from '../../../convex/governance/retention_floors.ts';
import { deleteKnowledgeDocument } from '../../../convex/legacy/knowledge_delete.ts';
import { readDomainConfigFile } from '../../../convex/lib/config_store/read_domain_file.ts';
import { getConfigRoot } from '../../../convex/lib/file_io.ts';
import { parseBlobRef } from '../../../convex/lib/storage/blob_ref.ts';
import type { RetentionPolicyConfig } from '../../../lib/shared/schemas/governance.ts';
import {
  retentionDefaultsConfigSchema,
  type RetentionCategory,
} from '../../../lib/shared/schemas/retention.ts';
import { toJson } from '../../db/sql.ts';
import { resolveObjectStore, s3DeleteObject } from '../../lib/object-store.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
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
async function loadOrgRetentionConfig(orgSlug: string) {
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
): Promise<{ bounds: AppliedBounds; appliedAt: number } | null> {
  const rows = await sql<{ bounds: AppliedBounds; appliedAt: number }[]>`
    SELECT bounds, applied_at_ms::float8 AS "appliedAt"
    FROM app.retention_applied_bounds
    WHERE org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

interface OrgPolicy {
  organizationId: string;
  config: RetentionPolicyConfig;
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
      config,
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
  agentRuns: number;
  auditLogs: number;
  tempFiles: number;
}

/** Best-effort blob removal — a missing object is success. */
async function deleteBlobBestEffort(
  orgSlug: string,
  storageRef: string,
): Promise<void> {
  try {
    const parsed = parseBlobRef(storageRef);
    if (parsed.backend !== 's3') return;
    const store = await resolveObjectStore(orgSlug);
    await s3DeleteObject(store, parsed.key);
  } catch (error) {
    console.warn(`[retention] blob delete failed for ${storageRef}:`, error);
  }
}

/** Hard-delete one document: corpus entry (keyed by the file REF), blobs,
 * file rows, dependent knowledge-entry chains, then the row. */
export async function purgeDocument(
  sql: Sql,
  orgSlug: string | null,
  doc: { id: string; fileRef: string | null; organizationId: string },
): Promise<void> {
  if (doc.fileRef !== null && orgSlug !== null) {
    try {
      const result = await deleteKnowledgeDocument({
        orgSlug,
        fileId: doc.fileRef,
      });
      if (!result.success) {
        console.warn(
          `[retention] corpus delete failed for document ${doc.id}: ${result.message}`,
        );
      }
    } catch (error) {
      console.warn(
        `[retention] corpus delete failed for document ${doc.id}:`,
        error,
      );
    }
    if (orgSlug !== null) {
      await deleteBlobBestEffort(orgSlug, doc.fileRef);
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

  // Pass A (grace > 0): flip active expired rows into the admin Trash.
  if (graceDays > 0) {
    const flipped = await sql<{ id: string }[]>`
      UPDATE app.documents SET
        lifecycle_status = 'expired', status_changed_at_ms = ${Date.now()}
      WHERE id IN (
        SELECT id FROM app.documents
        WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
          AND created_at_ms < ${cutoff}
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
          { id: string; fileRef: string | null; createdBy: string | null }[]
        >`
          SELECT id, file_ref AS "fileRef", created_by AS "createdBy"
          FROM app.documents
          WHERE org_id = ${org.organizationId}
            AND lifecycle_status IN ('trashed', 'expired')
            AND status_changed_at_ms < ${Date.now() - graceDays * DAY_MS}
          LIMIT ${BATCH_LIMIT}
        `
      : await sql<
          { id: string; fileRef: string | null; createdBy: string | null }[]
        >`
          SELECT id, file_ref AS "fileRef", created_by AS "createdBy"
          FROM app.documents
          WHERE org_id = ${org.organizationId} AND lifecycle_status IS NULL
            AND created_at_ms < ${cutoff}
          LIMIT ${BATCH_LIMIT}
        `;
  if (passB.length === 0) return processed;
  const orgSlug = await resolveOrgSlug(sql, org.organizationId);
  for (const doc of passB) {
    if (doc.createdBy !== null && holds.userMembershipIds.has(doc.createdBy)) {
      continue;
    }
    await purgeDocument(sql, orgSlug, {
      id: doc.id,
      fileRef: doc.fileRef,
      organizationId: org.organizationId,
    });
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
  // land in the admin Trash for the grace window.
  if (graceDays > 0) {
    const candidates = await sql<{ threadId: string; userId: string }[]>`
      SELECT tm.thread_id AS "threadId", tm.user_id AS "userId"
      FROM app.thread_metadata tm
      JOIN app.threads t ON t.id = tm.thread_id
      WHERE tm.org_id = ${org.organizationId} AND tm.chat_type = 'chat'
        AND tm.status = 'active' AND t.updated_at_ms < ${cutoff}
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
            AND ((tm.status = 'active' AND t.updated_at_ms < ${cutoff})
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
  if (org.config.auditLogEnabled !== true) return 0;
  const days = org.config.auditLogRetentionDays;
  if (typeof days !== 'number' || days <= 0) return 0;
  // Refuse to delete the very table that records why the hold exists.
  if (holds.orgHeld) return 0;
  const cutoff = Date.now() - days * DAY_MS;
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
  for (const row of rows) {
    if (orgSlug !== null) await deleteBlobBestEffort(orgSlug, row.storageRef);
    await sql`DELETE FROM app.file_metadata WHERE id = ${row.id}`;
  }
  return rows.length;
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
    agentRuns: 0,
    auditLogs: 0,
    tempFiles: 0,
  };
  if (holds.orgHeld) return stats;
  stats.documents = await sweepDocuments(sql, org, holds);
  stats.chatHistory = await sweepChatHistory(sql, org, holds);
  stats.contacts = await sweepContacts(sql, org, holds);
  stats.agentRuns = await sweepAgentRuns(sql, org, holds);
  stats.auditLogs = await sweepAuditLogs(sql, org, holds);
  stats.tempFiles =
    (await sweepTempFiles(sql, org, 'user', holds)) +
    (await sweepTempFiles(sql, org, 'agent', holds));
  return stats;
}
