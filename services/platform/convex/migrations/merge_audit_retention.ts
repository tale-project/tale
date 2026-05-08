/**
 * One-shot migration: fold the legacy `audit_retention` governance policy
 * into the unified `retention_policy` schema.
 *
 * For every org that has an `audit_retention` row, copy its `retentionDays`
 * into the org's `retention_policy` row under `auditLogRetentionDays` +
 * `auditLogEnabled: true`, then delete the legacy row. If the org has no
 * `retention_policy` row yet, create a minimal one.
 *
 * Idempotent: if no `audit_retention` row exists, the org is skipped.
 *
 * Invoked via `npx convex run migrations/merge_audit_retention:apply`.
 */

import { internalMutation } from '../_generated/server';

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    let migrated = 0;
    let deleted = 0;

    const legacyRows = [];
    for await (const policy of ctx.db.query('governancePolicies')) {
      // Legacy policy type removed from the union but may still exist in DB.
      const rawType: unknown = policy.policyType;
      if (rawType === 'audit_retention') {
        legacyRows.push(policy);
      }
    }

    for (const legacy of legacyRows) {
      const cfg = legacy.config;
      const retentionDays =
        cfg && typeof cfg === 'object' && 'retentionDays' in cfg
          ? cfg.retentionDays
          : undefined;

      if (typeof retentionDays === 'number') {
        const existing = await ctx.db
          .query('governancePolicies')
          .withIndex('by_org_policyType', (q) =>
            q
              .eq('organizationId', legacy.organizationId)
              .eq('policyType', 'retention_policy'),
          )
          .first();

        if (existing) {
          const existingCfg =
            existing.config && typeof existing.config === 'object'
              ? existing.config
              : {};
          await ctx.db.patch(existing._id, {
            config: {
              ...existingCfg,
              auditLogEnabled: true,
              auditLogRetentionDays: retentionDays,
            },
            updatedAt: Date.now(),
          });
        } else {
          await ctx.db.insert('governancePolicies', {
            organizationId: legacy.organizationId,
            policyType: 'retention_policy',
            config: {
              documentsRetentionDays: 90,
              auditLogEnabled: true,
              auditLogRetentionDays: retentionDays,
            },
            enabled: true,
            updatedAt: Date.now(),
          });
        }
        migrated++;
      }

      await ctx.db.delete(legacy._id);
      deleted++;
    }

    console.log(
      `[merge_audit_retention] migrated=${migrated} deleted=${deleted}`,
    );
    return { migrated, deleted };
  },
});
