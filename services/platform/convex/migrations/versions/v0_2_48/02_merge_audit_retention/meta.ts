import type { MigrationMeta } from '../../../framework/types';

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
 * up:   for every `audit_retention` row, copy its `config.retentionDays` into
 *       the org's `retention_policy` row as `auditLogRetentionDays` +
 *       `auditLogsEnabled: true` (creating a minimal `retention_policy` row if
 *       none exists), then delete the legacy `audit_retention` row.
 * down: for every `retention_policy` row carrying `auditLogRetentionDays`,
 *       re-create the `audit_retention` row from it and strip the two audit
 *       fields back off the `retention_policy` config.
 *
 * Destructive (up deletes the legacy rows). `governancePolicies` was dropped at
 * 0.2.85, so this can never be replayed against today's schema — reference-only;
 * the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.48/02_merge_audit_retention',
  semver: '0.2.48',
  numericId: 2,
  slug: 'merge_audit_retention',
  title: 'Fold legacy audit_retention governance policy into retention_policy',
  description:
    'v0.2.48 dropped the audit_retention policyType literal; existing rows had ' +
    'to be reshaped before the push could validate. up folds each ' +
    'audit_retention row’s retentionDays into the org’s retention_policy ' +
    '(auditLogRetentionDays + auditLogsEnabled), then deletes the legacy row; ' +
    'down re-creates the audit_retention row and strips those fields back off. ' +
    'Reference-only — governancePolicies was dropped at 0.2.85.',
  kind: 'reference',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
