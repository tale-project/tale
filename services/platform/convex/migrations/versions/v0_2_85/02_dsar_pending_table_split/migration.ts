/**
 * 0.2.85 / 02 — move staged DSAR "loosen-grace" changes off the legacy
 * `governancePolicies` row's `pending*` fields into the dedicated
 * `dsarPolicyPendingChanges` table.
 *
 * Expand step: reads the legacy `pending*` fields and materialises a pending
 * row; leaves the legacy row intact (dropped by 03). Reversible — `down` folds
 * the pending row back onto the legacy row and deletes it.
 *
 * The runner paginates `governancePolicies` (a table absent from the current
 * schema; read/written untyped). Both `up` and `down` are idempotent.
 */

import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function pendingRowForOrg(ctx: MutationCtx, organizationId: string) {
  return await ctx.db
    .query('dsarPolicyPendingChanges')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .first();
}

export const migration = defineDbMigration({
  title: 'Move staged DSAR policy changes into dsarPolicyPendingChanges',
  description:
    'For each legacy governancePolicies row carrying staged (pending*) DSAR ' +
    'changes, inserts an equivalent dsarPolicyPendingChanges row. Idempotent ' +
    '(skips orgs that already have a pending row). down folds the pending row ' +
    'back onto the legacy row.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['governancePolicies', 'dsarPolicyPendingChanges'] },
  table: 'governancePolicies',

  async up(ctx, doc) {
    const organizationId = str(doc.organizationId);
    const pendingConfig = record(doc.pendingConfig);
    const effectiveAt = num(doc.pendingEffectiveAt);
    if (!organizationId || !pendingConfig || effectiveAt === undefined) return;

    // Idempotent: one pending row per org.
    if (await pendingRowForOrg(ctx, organizationId)) return;

    await ctx.db.insert('dsarPolicyPendingChanges', {
      organizationId,
      pendingConfig,
      effectiveAt,
      proposedBy: str(doc.pendingProposedBy) ?? 'system-migration',
      proposedByEmail: str(doc.pendingProposedByEmail),
      proposedAt: num(doc.pendingProposedAt) ?? effectiveAt,
    });
  },

  async down(ctx, doc) {
    // Fold ONLY onto the DSAR row — the runner feeds down every
    // governancePolicies row for the org, and folding onto the first one
    // seen (e.g. password_policy) would corrupt both rows.
    if (str(doc.policyType) !== 'dsar_governance') return;
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    const pending = await pendingRowForOrg(ctx, organizationId);
    if (!pending) return;

    // Fold the pending row back onto the legacy governance row. The legacy
    // table is absent from the schema (schemaless at runtime), so patch untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).patch(doc._id, {
      pendingConfig: pending.pendingConfig,
      pendingEffectiveAt: pending.effectiveAt,
      pendingProposedBy: pending.proposedBy,
      pendingProposedByEmail: pending.proposedByEmail,
      pendingProposedAt: pending.proposedAt,
    });
    await ctx.db.delete(pending._id);
  },
});
