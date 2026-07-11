/**
 * 0.2.73 / 03 — fork the org-default `personalization` governance policy into
 * separate `custom_instructions` + `user_memories` policies.
 *
 * Shipped in v0.2.73 (verified against `git grep personalization v0.2.72` vs
 * `v0.2.73` over `convex/governance/` + `lib/shared/schemas/governance.ts`):
 * the `'personalization'` policyType was replaced by `'custom_instructions'`
 * and `'user_memories'` (the legacy literal was retained only as a deploy-window
 * slot the schema comment ties to `migrations/split_personalization_toggle`).
 * Operates on the legacy untyped `governancePolicies` table — absent from
 * today's schema, so it is read/written untyped
 * (`ctx.db.query('governancePolicies' as never)`, `(ctx.db as any)`).
 *
 * up: for each row with `policyType === 'personalization'`, insert two rows
 * (`custom_instructions` and `user_memories`) copying its `config` + metadata,
 * then delete the original. Idempotent (skips if the forked rows already exist
 * for the org).
 * down: re-merge — for each org that has BOTH `custom_instructions` and
 * `user_memories` rows, reinsert a single `personalization` row (config taken
 * from the `custom_instructions` side, which `up` cloned identically) and
 * delete the two split rows.
 *
 * Reversible, no data loss (both forked rows carry the same cloned config).
 * Reference-only: the runner never executes it — the test calls `up`/`down`
 * directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import { defineReferenceMigration } from '../../../framework/define';
import type { MigrationDoc } from '../../../framework/types';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface GovPolicyRow {
  _id: MigrationDoc['_id'];
  organizationId: string;
  policyType: string;
  config: unknown;
  enabled?: boolean;
  updatedBy?: string;
  updatedAt?: number;
  effectiveAt?: number;
}

async function policyOfType(
  ctx: MutationCtx,
  organizationId: string,
  policyType: string,
): Promise<GovPolicyRow | null> {
  const rows = (await ctx.db
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    .query('governancePolicies' as any)
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    .withIndex('by_organizationId', (q: any) =>
      q.eq('organizationId', organizationId),
    )
    .collect()) as unknown as GovPolicyRow[];
  return rows.find((r) => r.policyType === policyType) ?? null;
}

/** Carry the non-type metadata fields from a source row onto a new one. */
function carry(src: GovPolicyRow, policyType: string) {
  return {
    organizationId: src.organizationId,
    policyType,
    config: src.config,
    enabled: src.enabled,
    updatedBy: src.updatedBy,
    updatedAt: src.updatedAt,
    effectiveAt: src.effectiveAt,
  };
}

export const migration = defineReferenceMigration({
  title: 'Fork personalization governance policy into per-feature policies',
  description:
    "Forks each governancePolicies row of policyType 'personalization' into two " +
    "rows ('custom_instructions' and 'user_memories') copying its config, then " +
    'deletes the original. down re-merges the two rows back into a single ' +
    'personalization row. Operates on the legacy untyped governancePolicies ' +
    'table. Reversible, no data loss.',
  destructive: false,
  snapshot: 'none',
  table: 'governancePolicies',

  async up(ctx, doc) {
    if (str(doc.policyType) !== 'personalization') return;
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    const src = doc as unknown as GovPolicyRow;

    // Idempotent: skip if either forked row already exists for this org.
    if (
      (await policyOfType(ctx, organizationId, 'custom_instructions')) ||
      (await policyOfType(ctx, organizationId, 'user_memories'))
    )
      return;

    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).insert(
      'governancePolicies',
      carry(src, 'custom_instructions'),
    );
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).insert(
      'governancePolicies',
      carry(src, 'user_memories'),
    );
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  async down(ctx, doc) {
    // Drive the re-merge off the custom_instructions row; ignore the other one
    // (it is deleted here so it isn't re-processed).
    if (str(doc.policyType) !== 'custom_instructions') return;
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;

    const memories = await policyOfType(ctx, organizationId, 'user_memories');
    if (!memories) return; // not a fully-forked pair → nothing to merge

    // Idempotent: skip if a personalization row already exists.
    if (await policyOfType(ctx, organizationId, 'personalization')) return;

    const src = doc as unknown as GovPolicyRow;
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).insert(
      'governancePolicies',
      carry(src, 'personalization'),
    );
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(memories._id);
  },
});
