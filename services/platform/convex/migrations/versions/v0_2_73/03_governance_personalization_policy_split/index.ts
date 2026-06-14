/**
 * Reference migration: fork the `personalization` governance policy into
 * `custom_instructions` + `user_memories` on the legacy `governancePolicies`
 * table.
 *
 * The legacy table is absent from today's schema, so it is read/written
 * untyped (`ctx.db.query('governancePolicies' as never)`, `(ctx.db as any)`).
 * `up` forks the row in two and deletes the original; `down` re-merges. Both
 * idempotent + shape-guarded. The runner never executes a `reference`
 * migration; the test calls `up`/`down` directly.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: 'governancePolicies',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
