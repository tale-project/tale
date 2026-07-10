/**
 * 0.2.48 / 02 — fold the legacy `audit_retention` governance policy into the
 * unified `retention_policy`.
 *
 * v0.2.48 (#1577, "central retention & deletion configuration") removed the
 * `'audit_retention'` literal from the `governancePolicies.policyType` union.
 * Convex validates EXISTING rows against the new schema at push time, so any
 * org holding an `audit_retention` row would have failed the deploy — the
 * release shipped an ad-hoc `convex/migrations/merge_audit_retention.ts`
 * mutation to reshape those rows first. That one-shot file was later deleted
 * (#1879) and never ported into this versioned framework; this reference
 * migration restores it to the audit trail under round-trip test.
 *
 * Per-row over `governancePolicies`, idempotent, shape-guarded. `up` acts on
 * `audit_retention` rows; `down` acts on `retention_policy` rows that `up`
 * touched (those carrying `auditLogRetentionDays`). Destructive (up deletes
 * the legacy rows). `governancePolicies` was dropped at 0.2.85, so this can
 * never be replayed against today's schema — reference-only; the runner never
 * executes it; the test calls `up`/`down` directly.
 *
 * Asymmetry (why `destructive` + `snapshot: 'table-rows'`): when an org had no
 * `retention_policy` row, `up` creates a minimal one; `down` cannot tell that
 * row from a pre-existing one, so after `down` it is left behind (stripped of
 * the audit fields) rather than deleted. A real replay would restore exactly
 * from the row snapshot — reference-only here, so the asymmetry is documented,
 * not run.
 */

import { defineReferenceMigration } from '../../../framework/define';

// `governancePolicies` was dropped from the schema at 0.2.85; this reference
// migration reads/writes it untyped (the runner never executes it). One alias
// keeps the unavoidable `any` in a single, documented place.
// oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
type LegacyDb = any;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

async function policyForOrg(
  db: LegacyDb,
  organizationId: string,
  policyType: string,
) {
  return await db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q: LegacyDb) =>
      q.eq('organizationId', organizationId).eq('policyType', policyType),
    )
    .first();
}

export const migration = defineReferenceMigration({
  title: 'Fold legacy audit_retention governance policy into retention_policy',
  description:
    'v0.2.48 dropped the audit_retention policyType literal; existing rows had ' +
    'to be reshaped before the push could validate. up folds each ' +
    'audit_retention row’s retentionDays into the org’s retention_policy ' +
    '(auditLogRetentionDays + auditLogsEnabled), then deletes the legacy row; ' +
    'down re-creates the audit_retention row and strips those fields back off. ' +
    'Reference-only — governancePolicies was dropped at 0.2.85.',
  destructive: true,
  snapshot: 'table-rows',
  table: 'governancePolicies',

  async up(ctx, doc) {
    if (doc.policyType !== 'audit_retention') return; // only legacy rows
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    const db: LegacyDb = ctx.db;
    const retentionDays = num(record(doc.config).retentionDays);

    if (retentionDays !== undefined) {
      const existing = await policyForOrg(
        db,
        organizationId,
        'retention_policy',
      );
      const now = Date.now();
      if (existing) {
        await db.patch(existing._id, {
          config: {
            ...record(existing.config),
            auditLogsEnabled: true,
            auditLogRetentionDays: retentionDays,
          },
          updatedAt: now,
        });
      } else {
        await db.insert('governancePolicies', {
          organizationId,
          policyType: 'retention_policy',
          config: {
            enabled: false,
            retentionDays: 90,
            auditLogsEnabled: true,
            auditLogRetentionDays: retentionDays,
          },
          enabled: true,
          updatedAt: now,
        });
      }
    }

    await db.delete(doc._id); // drop the legacy audit_retention row
  },

  async down(ctx, doc) {
    if (doc.policyType !== 'retention_policy') return;
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    const config = record(doc.config);
    const auditLogRetentionDays = num(config.auditLogRetentionDays);
    if (auditLogRetentionDays === undefined) return; // not touched by up → no-op
    const db: LegacyDb = ctx.db;

    // Re-create the legacy audit_retention row (idempotent).
    if (!(await policyForOrg(db, organizationId, 'audit_retention'))) {
      await db.insert('governancePolicies', {
        organizationId,
        policyType: 'audit_retention',
        config: { retentionDays: auditLogRetentionDays },
        enabled: true,
        updatedAt: Date.now(),
      });
    }

    // Strip the folded fields back off retention_policy.
    const restored = { ...config };
    delete restored.auditLogsEnabled;
    delete restored.auditLogRetentionDays;
    await db.patch(doc._id, { config: restored, updatedAt: Date.now() });
  },
});
