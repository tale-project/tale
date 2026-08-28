import type { Sql } from 'postgres';

import {
  applyEnvTighteningAll,
  clampConfigToBounds,
  isRetentionDisabled,
  type EffectiveBoundDef,
} from '../../../convex/governance/retention_floors.ts';
import { readDomainConfigFile } from '../../../convex/lib/config_store/read_domain_file.ts';
import { getConfigRoot } from '../../../convex/lib/file_io.ts';
import type { RetentionPolicyConfig } from '../../../lib/shared/schemas/governance.ts';
import {
  retentionDefaultsConfigSchema,
  type RetentionCategory,
} from '../../../lib/shared/schemas/retention.ts';
import { toJson } from '../../db/sql.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadActiveHolds, type ActiveHolds } from '../legal_holds/service.ts';

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
): Promise<Record<string, SweepStats>> {
  if (isRetentionDisabled()) {
    console.warn('[retention] TALE_RETENTION_DISABLED=true — skipping run');
    return {};
  }
  const orgs = await sql<{ id: string }[]>`
    SELECT org_id AS id FROM app.retention_applied_bounds
  `;
  const results: Record<string, SweepStats> = {};
  for (const org of orgs) {
    try {
      const policy = await clampedPolicyFor(sql, org.id);
      if (policy === null) continue;
      const holds = await loadActiveHolds(sql, org.id);
      results[org.id] = await sweepOrg(sql, policy, holds);
    } catch (error) {
      // One org's failure must not starve the rest of the fleet.
      console.error(`[retention] org ${org.id} sweep failed:`, error);
    }
  }
  return results;
}
