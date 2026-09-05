import type { Sql, TransactionSql } from 'postgres';

import {
  dsarGovernanceConfigSchema,
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
} from '../../../lib/shared/schemas/governance.ts';
import {
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from '../../../lib/shared/schemas/retention.ts';
import type { ChatFilterEventInput } from '../../core/governance/chat_filter_events.ts';
import { isLoosening } from '../../core/governance/dsar_policy.ts';
import { RETENTION_POLICY_FIELD_BY_CATEGORY } from '../../core/governance/retention_floors.ts';
import { decryptSecret, encryptSecret } from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import { writeGovernancePolicyFile } from '../../lib/governance-policy-write.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * The governance settings TAIL: legal matters (grouping for holds), the
 * retention-shortening cooldown store, the DSAR owner-only grace flow
 * (loosening staged 24h; applied once its effective time passes — by the
 * erasure lane's enforcement read, by the editor's read, and by the
 * 5-minute `governance.apply_dsar_policy_changes` sweep, so the change
 * takes effect whether or not anyone opens the page), the guardrails
 * secret store, and the chat-filter event listing the Security page reads.
 */

export class GovernanceTailError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'GovernanceTailError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Legal matters
// ---------------------------------------------------------------------------

export interface LegalMatterRow {
  id: string;
  name: string;
  caseNumber: string | null;
  description: string | null;
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: number;
  closedBy: string | null;
  closedAt: number | null;
}

const MATTER_COLUMNS = `
  id, name, case_number AS "caseNumber", description, status,
  created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
  closed_by AS "closedBy", closed_at_ms::float8 AS "closedAt"
`;

export interface LegalMatterItemView extends LegalMatterRow {
  _id: string;
  organizationId: string;
  createdByName: string;
  closedByName?: string;
  linkedActiveHolds: number;
}

/** Matters list for the Legal-hold settings page (the 0.4
 * `listLegalMatters` item view: resolved names + active-hold counts;
 * status defaults to `all`). */
export async function listLegalMatters(
  sql: Sql,
  organizationId: string,
  args: { status?: 'open' | 'closed' | 'all' } = {},
): Promise<LegalMatterItemView[]> {
  const status = args.status ?? 'all';
  const rows = await sql<(LegalMatterRow & { linkedActiveHolds: number })[]>`
    SELECT ${sql.unsafe(MATTER_COLUMNS)},
      (
        SELECT count(*)::int FROM app.legal_holds h
        WHERE h.org_id = app.legal_matters.org_id
          AND h.matter_ref = app.legal_matters.id
          AND h.released_at_ms IS NULL
      ) AS "linkedActiveHolds"
    FROM app.legal_matters
    WHERE org_id = ${organizationId}
      AND (${status} = 'all' OR status = ${status})
    ORDER BY created_at_ms DESC
    LIMIT 200
  `;
  const userIds = [
    ...new Set(
      rows.flatMap((row) =>
        [row.createdBy, row.closedBy].filter((id): id is string => id !== null),
      ),
    ),
  ];
  const users =
    userIds.length === 0
      ? []
      : await sql<{ id: string; name: string | null }[]>`
          SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
        `;
  const nameOf = new Map(users.map((user) => [user.id, user.name] as const));
  return rows.map((row) => {
    const view: LegalMatterItemView = Object.assign({}, row, {
      _id: row.id,
      organizationId,
      createdByName: nameOf.get(row.createdBy) ?? row.createdBy,
    });
    if (row.closedBy !== null) {
      view.closedByName = nameOf.get(row.closedBy) ?? row.closedBy;
    }
    return view;
  });
}

export async function upsertLegalMatter(
  tx: TransactionSql,
  auth: { organizationId: string; userId: string; email?: string },
  args: {
    matterId?: string;
    name: string;
    caseNumber?: string;
    description?: string;
  },
): Promise<string> {
  const name = args.name.trim();
  if (name.length === 0 || name.length > 300) {
    throw new GovernanceTailError('MATTER_NAME_INVALID', 'Invalid name');
  }
  let matterId = args.matterId;
  if (matterId !== undefined) {
    const updated = await tx<{ id: string }[]>`
      UPDATE app.legal_matters SET
        name = ${name},
        case_number = ${args.caseNumber ?? null},
        description = ${args.description ?? null}
      WHERE id = ${matterId} AND org_id = ${auth.organizationId}
        AND status = 'open'
      RETURNING id
    `;
    if (!updated[0]) {
      throw new GovernanceTailError(
        'MATTER_NOT_FOUND',
        'Matter not found',
        404,
      );
    }
  } else {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.legal_matters (
        org_id, name, case_number, description, status, created_by,
        created_at_ms
      ) VALUES (
        ${auth.organizationId}, ${name}, ${args.caseNumber ?? null},
        ${args.description ?? null}, 'open', ${auth.userId}, ${Date.now()}
      ) RETURNING id
    `;
    matterId = inserted[0]?.id;
    if (matterId === undefined) {
      throw new GovernanceTailError('MATTER_CREATE_FAILED', 'Insert failed');
    }
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action:
      args.matterId === undefined
        ? 'legal_matter.created'
        : 'legal_matter.updated',
    category: 'security',
    resourceType: 'legal_matter',
    resourceId: matterId,
    resourceName: name,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'legal_hold',
    entityId: matterId,
  });
  return matterId;
}

export async function closeLegalMatter(
  tx: TransactionSql,
  auth: { organizationId: string; userId: string; email?: string },
  args: { matterId: string; releaseReason?: string },
): Promise<{ releaseRequestsFiled: number }> {
  const now = Date.now();
  const existing = await tx<{ id: string; name: string; status: string }[]>`
    SELECT id, name, status FROM app.legal_matters
    WHERE id = ${args.matterId} AND org_id = ${auth.organizationId}
    LIMIT 1
  `;
  const matter = existing[0];
  if (!matter) {
    throw new GovernanceTailError('MATTER_NOT_FOUND', 'Matter not found', 404);
  }
  if (matter.status === 'closed') {
    return { releaseRequestsFiled: 0 };
  }
  // Fan out: every active hold linked to this matter gets a pending
  // release request. Approval still requires a second admin (dual-control
  // survives — matter-close does NOT auto-release); holds that already
  // carry a pending/approved request are skipped.
  const reason = args.releaseReason?.trim() || `matter closed: ${matter.name}`;
  const filed = await tx<{ id: string }[]>`
    INSERT INTO app.legal_hold_release_requests (
      org_id, hold_id, requested_by, requested_at_ms, reason, status
    )
    SELECT h.org_id, h.id, ${auth.userId}, ${now}, ${reason}, 'pending'
    FROM app.legal_holds h
    WHERE h.org_id = ${auth.organizationId}
      AND h.matter_ref = ${matter.id} AND h.released_at_ms IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.legal_hold_release_requests r
        WHERE r.hold_id = h.id AND r.status IN ('pending', 'approved')
      )
    RETURNING id
  `;
  const releaseRequestsFiled = filed.length;
  await tx`
    UPDATE app.legal_matters SET
      status = 'closed', closed_by = ${auth.userId}, closed_at_ms = ${now}
    WHERE id = ${matter.id}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: 'legal_matter_closed',
    category: 'admin',
    resourceType: 'legal_matter',
    resourceId: matter.id,
    resourceName: matter.name,
    status: 'success',
    newState: { releaseRequestsFiled },
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'legal_hold',
    entityId: matter.id,
  });
  return { releaseRequestsFiled };
}

// ---------------------------------------------------------------------------
// Retention pending change (the 7-day shortening cooldown)
// ---------------------------------------------------------------------------

export interface RetentionPendingChange {
  id: string;
  appliesAt: number;
  oldConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  requestedBy: string;
  requestedAt: number;
  summary: string | null;
}

const PENDING_COLUMNS = `
  id, applies_at_ms::float8 AS "appliesAt", old_config AS "oldConfig",
  new_config AS "newConfig", requested_by AS "requestedBy",
  requested_at_ms::float8 AS "requestedAt", summary
`;

/** The live pending row, dropped lazily once its cooldown elapsed. */
export async function getPendingRetentionChange(
  sql: Sql,
  organizationId: string,
): Promise<RetentionPendingChange | null> {
  const rows = await sql<RetentionPendingChange[]>`
    SELECT ${sql.unsafe(PENDING_COLUMNS)}
    FROM app.retention_policy_pending_changes
    WHERE org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.appliesAt <= Date.now()) {
    await sql`
      DELETE FROM app.retention_policy_pending_changes WHERE id = ${row.id}
    `;
    return null;
  }
  return row;
}

/** The summary's label per category (the pending-change banner's text). */
const RETENTION_CATEGORY_LABELS: Record<RetentionCategory, string> = {
  documents: 'documents',
  userTempHours: 'user temp files',
  agentTempHours: 'agent temp files',
  chatHistory: 'chat history',
  auditLog: 'audit log',
  workflowLog: 'workflow logs',
  usageLedger: 'usage ledger',
  loginAttempt: 'login attempts',
  chatFilterEvents: 'chat filter events',
  messageFeedback: 'message feedback',
  contacts: 'contacts',
  externalConversations: 'external conversations',
  notifications: 'notifications',
  agentRuns: 'agent runs',
};

/** The 0.4 shortening detector — a category disabled in the new config
 * deletes nothing, so its smaller number is not a shortening. Walks every
 * bounded category through the ONE field↔category map (a hand list here
 * missed `notifications` and `agentRuns`, so shortening either skipped the
 * cooldown) plus the grace window. */
export function detectRetentionShortening(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): string | null {
  const checks: Array<[string, string]> = [
    ...RETENTION_CATEGORIES.map((category): [string, string] => [
      RETENTION_POLICY_FIELD_BY_CATEGORY[category],
      RETENTION_CATEGORY_LABELS[category],
    ]),
    ['deletionGraceDays', 'deletion grace'],
  ];
  const reduced: string[] = [];
  for (const [key, label] of checks) {
    const enabledKey = key.replace(/Retention(Days|Hours)$/, 'Enabled');
    if (enabledKey !== key && newConfig[enabledKey] === false) continue;
    const oldVal = oldConfig[key];
    const newVal = newConfig[key];
    if (typeof oldVal !== 'number' || typeof newVal !== 'number') continue;
    if (newVal < oldVal) reduced.push(`${label} (${oldVal} → ${newVal})`);
  }
  return reduced.length === 0 ? null : `Reduced: ${reduced.join('; ')}`;
}

const RETENTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Stage the cooldown row when a save shortened any live category. */
export async function stageRetentionShortening(
  tx: TransactionSql,
  auth: { organizationId: string; userId: string; email?: string },
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): Promise<string | null> {
  const summary = detectRetentionShortening(oldConfig, newConfig);
  if (summary === null) return null;
  await tx`
    DELETE FROM app.retention_policy_pending_changes
    WHERE org_id = ${auth.organizationId}
  `;
  await tx`
    INSERT INTO app.retention_policy_pending_changes (
      org_id, applies_at_ms, old_config, new_config, requested_by,
      requested_at_ms, summary
    ) VALUES (
      ${auth.organizationId}, ${Date.now() + RETENTION_COOLDOWN_MS},
      ${tx.json(toJson(oldConfig))}, ${tx.json(toJson(newConfig))},
      ${auth.userId}, ${Date.now()}, ${summary}
    )
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: 'policy.retention_shortening_pending',
    category: 'security',
    resourceType: 'governance_policy',
    resourceId: 'retention_policy',
    metadata: { summary },
    status: 'success',
  });
  return summary;
}

/** Cancel the cooldown: revert the on-disk policy to the snapshot. */
export async function cancelPendingRetentionChange(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
): Promise<void> {
  const pending = await getPendingRetentionChange(sql, auth.organizationId);
  if (pending === null) {
    throw new GovernanceTailError('NO_PENDING_CHANGE', 'Nothing pending', 404);
  }
  const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
  if (orgSlug === null) {
    throw new GovernanceTailError(
      'ORG_NOT_FOUND',
      'Organization not found',
      404,
    );
  }
  await writeGovernancePolicyFile(
    orgSlug,
    'retention_policy',
    pending.oldConfig,
  );
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM app.retention_policy_pending_changes
      WHERE id = ${pending.id}
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'policy.retention_shortening_cancelled',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: 'retention_policy',
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'governance_policy',
      entityId: 'retention_policy',
    });
  });
}

// ---------------------------------------------------------------------------
// DSAR governance (owner-only; loosening staged with a 24h grace)
// ---------------------------------------------------------------------------

const DSAR_LOOSEN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface DsarPendingView {
  config: DsarGovernanceConfig;
  effectiveAt: number;
  proposedBy: string;
  proposedByEmail?: string;
  proposedAt: number;
}

async function readDsarConfig(
  sql: Sql,
  organizationId: string,
): Promise<DsarGovernanceConfig> {
  const raw = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'dsar_governance',
  );
  if (raw === null) return DEFAULT_DSAR_GOVERNANCE;
  const parsed = dsarGovernanceConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_DSAR_GOVERNANCE;
}

interface DsarPendingRow {
  id: string;
  pendingConfig: Record<string, unknown>;
  effectiveAt: number;
  proposedBy: string;
  proposedByEmail: string | null;
  proposedAt: number;
}

const DSAR_PENDING_COLUMNS = `
  id, pending_config AS "pendingConfig",
  effective_at_ms::float8 AS "effectiveAt", proposed_by AS "proposedBy",
  proposed_by_email AS "proposedByEmail", proposed_at_ms::float8 AS "proposedAt"
`;

/** Drop the pending row (the claim — whoever gets it back records the
 * apply) and audit the change becoming effective. */
async function claimMaturedDsarChange(
  tx: TransactionSql,
  organizationId: string,
  row: DsarPendingRow,
  applied: DsarGovernanceConfig | null,
): Promise<boolean> {
  const claimed = await tx<{ id: string }[]>`
    DELETE FROM app.dsar_policy_pending_changes
    WHERE id = ${row.id} RETURNING id
  `;
  if (!claimed[0] || applied === null) return false;
  await createAuditLog(tx, {
    organizationId,
    actorId: 'system',
    actorType: 'system',
    action: 'policy.dsar_governance_loosening_applied',
    category: 'security',
    resourceType: 'governance_policy',
    resourceId: 'dsar_governance',
    newState: {
      config: applied,
      effectiveAt: row.effectiveAt,
      proposedBy: row.proposedBy,
    },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'governance_policy',
    entityId: 'dsar_governance',
  });
  return true;
}

/**
 * Apply the org's staged DSAR loosening once its grace has elapsed: write
 * the policy file, drop the pending row, audit it. Every reader that must
 * see the EFFECTIVE policy calls this first — the erasure lane's
 * enforcement read, the editor's read, and the scheduled sweep — so the
 * change the owner was told would be in force at <date> is in force then,
 * not whenever someone next happens to open the policy page. Idempotent and
 * race-safe: two racers write the same file; the DELETE decides who records
 * the audit row. Works inside a caller's transaction (postgres.js marks one
 * with `savepoint`) or opens its own. Returns true when a change applied.
 */
export async function applyMaturedDsarPolicyChange(
  db: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const rows = await db<DsarPendingRow[]>`
    SELECT ${db.unsafe(DSAR_PENDING_COLUMNS)}
    FROM app.dsar_policy_pending_changes
    WHERE org_id = ${organizationId} AND effective_at_ms <= ${Date.now()}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return false;
  const parsed = dsarGovernanceConfigSchema.safeParse(row.pendingConfig);
  const orgSlug = await resolveOrgSlug(db, organizationId);
  let applied: DsarGovernanceConfig | null = null;
  if (parsed.success && orgSlug !== null) {
    await writeGovernancePolicyFile(orgSlug, 'dsar_governance', parsed.data);
    applied = parsed.data;
  } else {
    console.warn(
      `[governance] dropping a pending DSAR policy change for org ${organizationId} that cannot apply:`,
      parsed.success ? 'organization not found' : parsed.error.message,
    );
  }
  const claim = (tx: TransactionSql): Promise<boolean> =>
    claimMaturedDsarChange(tx, organizationId, row, applied);
  return 'savepoint' in db ? claim(db) : db.begin(claim);
}

/** The scheduled twin of the lazy apply: every org whose staged loosening
 * has matured gets it applied now. One org's failure never starves the rest. */
export async function applyMaturedDsarPolicyChanges(sql: Sql): Promise<number> {
  const due = await sql<{ orgId: string }[]>`
    SELECT DISTINCT org_id AS "orgId" FROM app.dsar_policy_pending_changes
    WHERE effective_at_ms <= ${Date.now()}
  `;
  let applied = 0;
  for (const { orgId } of due) {
    try {
      if (await applyMaturedDsarPolicyChange(sql, orgId)) applied += 1;
    } catch (error) {
      console.error(
        `[governance] DSAR policy apply failed for org ${orgId}:`,
        error,
      );
    }
  }
  return applied;
}

/** The editor's read: a matured pending change applies first (as it does
 * on every other path), then the effective config and what is still staged. */
export async function getDsarPolicyForUi(
  sql: Sql,
  auth: { organizationId: string; role: string },
): Promise<{
  config: DsarGovernanceConfig;
  pending: DsarPendingView | null;
  callerIsOwner: boolean;
}> {
  await applyMaturedDsarPolicyChange(sql, auth.organizationId);
  const rows = await sql<DsarPendingRow[]>`
    SELECT ${sql.unsafe(DSAR_PENDING_COLUMNS)}
    FROM app.dsar_policy_pending_changes
    WHERE org_id = ${auth.organizationId}
    LIMIT 1
  `;
  const pendingRow = rows[0];
  const config = await readDsarConfig(sql, auth.organizationId);
  let pending: DsarPendingView | null = null;
  if (pendingRow !== undefined) {
    const parsed = dsarGovernanceConfigSchema.safeParse(
      pendingRow.pendingConfig,
    );
    if (parsed.success) {
      pending = {
        config: parsed.data,
        effectiveAt: pendingRow.effectiveAt,
        proposedBy: pendingRow.proposedBy,
        ...(pendingRow.proposedByEmail !== null
          ? { proposedByEmail: pendingRow.proposedByEmail }
          : {}),
        proposedAt: pendingRow.proposedAt,
      };
    }
  }
  return {
    config,
    pending,
    callerIsOwner: auth.role.toLowerCase() === 'owner',
  };
}

export async function proposeDsarPolicy(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  config: DsarGovernanceConfig,
): Promise<{ staged: boolean; effectiveAt?: number }> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app.dsar_policy_pending_changes
    WHERE org_id = ${auth.organizationId}
    LIMIT 1
  `;
  if (existing[0]) {
    throw new GovernanceTailError(
      'PENDING_CHANGE_EXISTS',
      'A pending DSAR policy change is already staged. Cancel it before proposing a new one.',
    );
  }
  const current = await readDsarConfig(sql, auth.organizationId);
  const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
  if (orgSlug === null) {
    throw new GovernanceTailError(
      'ORG_NOT_FOUND',
      'Organization not found',
      404,
    );
  }
  if (!isLoosening(current, config)) {
    // Tightening (or no-op): effective immediately.
    await writeGovernancePolicyFile(orgSlug, 'dsar_governance', config);
    await sql.begin(async (tx) => {
      await createAuditLog(tx, {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
        actorType: 'user',
        action: 'policy.dsar_governance_updated',
        category: 'security',
        resourceType: 'governance_policy',
        resourceId: 'dsar_governance',
        previousState: { config: current },
        newState: { config },
        status: 'success',
      });
      await emitHintInTx(tx, {
        orgId: auth.organizationId,
        entity: 'governance_policy',
        entityId: 'dsar_governance',
      });
    });
    return { staged: false };
  }
  const effectiveAt = Date.now() + DSAR_LOOSEN_GRACE_MS;
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app.dsar_policy_pending_changes (
        org_id, pending_config, effective_at_ms, proposed_by,
        proposed_by_email, proposed_at_ms
      ) VALUES (
        ${auth.organizationId}, ${tx.json(toJson(config))}, ${effectiveAt},
        ${auth.userId}, ${auth.email ?? null}, ${Date.now()}
      )
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'policy.dsar_governance_loosening_staged',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: 'dsar_governance',
      newState: { config, effectiveAt },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'governance_policy',
      entityId: 'dsar_governance',
    });
  });
  return { staged: true, effectiveAt };
}

export async function cancelPendingDsarPolicyChange(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
): Promise<void> {
  const deleted = await sql<{ id: string }[]>`
    DELETE FROM app.dsar_policy_pending_changes
    WHERE org_id = ${auth.organizationId}
    RETURNING id
  `;
  if (!deleted[0]) {
    throw new GovernanceTailError('NO_PENDING_CHANGE', 'Nothing pending', 404);
  }
  await sql.begin(async (tx) => {
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'policy.dsar_governance_loosening_cancelled',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: 'dsar_governance',
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'governance_policy',
      entityId: 'dsar_governance',
    });
  });
}

// ---------------------------------------------------------------------------
// Guardrails secrets + moderation-provider surface
// ---------------------------------------------------------------------------

export const MODERATION_SECRET_NAME = 'moderation_auth_header';

export async function saveGovernanceSecret(
  sql: Sql,
  auth: { organizationId: string; userId: string },
  args: { name: string; value: string },
): Promise<void> {
  const encrypted = encryptSecret(args.value);
  await sql`
    INSERT INTO app.governance_secrets (
      org_id, name, ciphertext, nonce, auth_tag, key_fingerprint,
      updated_at_ms, updated_by
    ) VALUES (
      ${auth.organizationId}, ${args.name}, ${encrypted.ciphertext},
      ${encrypted.nonce}, ${encrypted.authTag}, ${encrypted.keyFingerprint},
      ${Date.now()}, ${auth.userId}
    )
    ON CONFLICT (org_id, name) DO UPDATE SET
      ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
      auth_tag = EXCLUDED.auth_tag,
      key_fingerprint = EXCLUDED.key_fingerprint,
      updated_at_ms = EXCLUDED.updated_at_ms,
      updated_by = EXCLUDED.updated_by
  `;
}

export async function hasGovernanceSecret(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.governance_secrets
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  return rows[0] !== undefined;
}

/** Decrypt one guardrails secret; null on absence or a rotated key (the
 * enforcement pipeline treats that as "not configured", never a crash). */
/** Masked view of a stored secret for the settings panel (the 0.4
 * `hasModerationSecret` contract): `null` = not configured; a masked
 * preview when readable; a rotation notice when the row exists but the
 * current key can't decrypt it. */
export async function readGovernanceSecretMasked(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<string | null> {
  const rows = await sql<
    {
      ciphertext: string;
      nonce: string;
      authTag: string;
      keyFingerprint: string;
    }[]
  >`
    SELECT ciphertext, nonce, auth_tag AS "authTag",
           key_fingerprint AS "keyFingerprint"
    FROM app.governance_secrets
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  try {
    const plaintext = decryptSecret(row);
    if (plaintext.length <= 9) return '••••••••••';
    return plaintext.slice(0, 6) + '••••••' + plaintext.slice(-3);
  } catch (error) {
    console.warn(
      `[governance] secret '${name}' is undecryptable with the current key:`,
      error,
    );
    return '•••• (key rotated — re-save)';
  }
}

export async function readGovernanceSecret(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<string | null> {
  const rows = await sql<
    {
      ciphertext: string;
      nonce: string;
      authTag: string;
      keyFingerprint: string;
    }[]
  >`
    SELECT ciphertext, nonce, auth_tag AS "authTag",
           key_fingerprint AS "keyFingerprint"
    FROM app.governance_secrets
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  try {
    return decryptSecret(row);
  } catch (error) {
    console.warn(`[governance] secret '${name}' failed to decrypt:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chat-filter events (the Security page's listing)
// ---------------------------------------------------------------------------

export interface ChatFilterEventRow {
  id: string;
  sanitizationRunId: string;
  threadId: string;
  messageId: string | null;
  filterName: string;
  direction: string;
  kind: string;
  categoryIds: string[];
  matchCount: number | null;
  truncated: boolean | null;
  errorClass: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  attempt: number | null;
  agentSlug: string | null;
  createdAt: number;
}

/** The PRODUCER of the table the Security page lists and the stats fold
 * reads — one row per non-pass guardrail verdict of a chat turn. */
export async function recordChatFilterEvent(
  sql: Sql,
  organizationId: string,
  event: ChatFilterEventInput,
): Promise<void> {
  await sql`
    INSERT INTO app.chat_filter_events (
      org_id, sanitization_run_id, thread_id, message_id, filter_name,
      direction, kind, category_ids, match_count, truncated, error_class,
      http_status, duration_ms, attempt, agent_slug, actor_type,
      created_at_ms
    ) VALUES (
      ${organizationId}, ${event.sanitizationRunId}, ${event.threadId},
      ${event.messageId ?? null}, ${event.filterName}, ${event.direction},
      ${event.kind}, ${sql.array([...event.categoryIds])},
      ${event.matchCount ?? null}, ${event.truncated ?? null},
      ${event.errorClass ?? null}, ${event.httpStatus ?? null},
      ${event.durationMs ?? null}, ${event.attempt ?? null},
      ${event.agentSlug ?? null}, ${event.actorType ?? null}, ${Date.now()}
    )
  `;
}

export async function listRecentChatFilterEvents(
  sql: Sql,
  organizationId: string,
  args: { limit?: number; filterName?: string; kind?: string } = {},
): Promise<ChatFilterEventRow[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  return sql<ChatFilterEventRow[]>`
    SELECT id, sanitization_run_id AS "sanitizationRunId",
           thread_id AS "threadId", message_id AS "messageId",
           filter_name AS "filterName", direction, kind,
           category_ids AS "categoryIds", match_count AS "matchCount",
           truncated, error_class AS "errorClass",
           http_status AS "httpStatus", duration_ms AS "durationMs",
           attempt, agent_slug AS "agentSlug", actor_type AS "actorType",
           created_at_ms::float8 AS "createdAt"
    FROM app.chat_filter_events
    WHERE org_id = ${organizationId}
      AND (${args.filterName ?? null}::text IS NULL
        OR filter_name = ${args.filterName ?? null})
      AND (${args.kind ?? null}::text IS NULL OR kind = ${args.kind ?? null})
    ORDER BY created_at_ms DESC
    LIMIT ${limit}
  `;
}

const GUARDRAIL_STATS_MAX_SCAN = 5000;

/** The 0.4 `getGuardrailStats` fold over one bounded newest-first page. */
export async function getGuardrailStats(
  sql: Sql,
  organizationId: string,
  args: { periodDays: number },
): Promise<Record<string, unknown>> {
  const { DAY_MS, dailyKeys, utcDateKey } =
    await import('../../../lib/shared/metrics-window.ts');
  const now = Date.now();
  const windowStart = now - args.periodDays * DAY_MS;
  const rows = await sql<
    {
      kind: string;
      filterName: string;
      direction: string;
      categoryIds: string[];
      createdAt: number;
    }[]
  >`
    SELECT kind, filter_name AS "filterName", direction,
           category_ids AS "categoryIds",
           created_at_ms::float8 AS "createdAt"
    FROM app.chat_filter_events
    WHERE org_id = ${organizationId} AND created_at_ms >= ${windowStart}
    ORDER BY created_at_ms DESC
    LIMIT ${GUARDRAIL_STATS_MAX_SCAN + 1}
  `;
  const capped = rows.length > GUARDRAIL_STATS_MAX_SCAN;
  const walk = rows.slice(0, GUARDRAIL_STATS_MAX_SCAN);

  const kindCounts = new Map<string, number>();
  const filterCounts = new Map<string, number>();
  const directionCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const seriesMap = new Map(
    dailyKeys(args.periodDays, now).map((dateKey) => [
      dateKey,
      { dateKey, detected: 0, blocked: 0, errors: 0 },
    ]),
  );
  const increment = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const event of walk) {
    increment(kindCounts, event.kind);
    increment(filterCounts, event.filterName);
    increment(directionCounts, event.direction);
    for (const categoryId of event.categoryIds) {
      increment(categoryCounts, categoryId);
    }
    const seriesPoint = seriesMap.get(utcDateKey(event.createdAt));
    if (seriesPoint) {
      if (event.kind === 'detected') seriesPoint.detected++;
      else if (event.kind === 'blocked') seriesPoint.blocked++;
      else seriesPoint.errors++;
    }
  }
  const entries = (
    map: Map<string, number>,
  ): { key: string; count: number }[] =>
    [...map]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  return {
    byKind: entries(kindCounts),
    byFilter: entries(filterCounts),
    byDirection: entries(directionCounts),
    byCategory: entries(categoryCounts),
    series: [...seriesMap.values()],
    capped,
  };
}
