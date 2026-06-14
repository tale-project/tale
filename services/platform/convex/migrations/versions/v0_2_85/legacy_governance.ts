/**
 * V8 accessors for the legacy `governancePolicies` table. The table is no
 * longer in the production schema (governance settings became per-org JSON
 * files), but Convex still permits reading a table that exists in the database
 * yet is absent from the schema — exactly the situation on an install upgrading
 * across the 0.2.84 → 0.2.85 boundary. These helpers centralise the untyped
 * access so the v0.2.85 migrations don't each re-cast.
 *
 * Shared by:
 *  - 01_governance_db_to_json  (node) — reads rows to export to files
 *  - 02_dsar_pending_table_split (db) — reads rows' pending* fields
 *  - 03_drop_legacy_governance_tables (db) — drops rows after export
 */

import { v } from 'convex/values';

import { internalQuery } from '../../../_generated/server';

/** The legacy row shape (only the fields the migrations consume). */
export interface LegacyGovernancePolicyRow {
  _id: string;
  organizationId: string;
  policyType: string;
  config: Record<string, unknown>;
  enabled?: boolean;
  effectiveAt?: number;
  pendingConfig?: Record<string, unknown>;
  pendingEffectiveAt?: number;
  pendingProposedBy?: string;
  pendingProposedByEmail?: string;
  pendingProposedAt?: number;
}

/**
 * All legacy `governancePolicies` rows for one org. Returns `[]` when the table
 * does not exist (a fresh install that never had DB-backed governance) — the
 * untyped `.collect()` throws on a truly-absent table, so we treat that as
 * empty rather than failing the whole migration.
 */
export const listGovernancePoliciesByOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<LegacyGovernancePolicyRow[]> => {
    let rows: LegacyGovernancePolicyRow[];
    try {
      // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
      rows = (await (
        ctx.db.query('governancePolicies' as any) as any
      ).collect()) as LegacyGovernancePolicyRow[];
    } catch (err) {
      console.warn(
        '[migration 0.2.85] governancePolicies table not readable (likely already dropped):',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    return rows.filter((r) => r.organizationId === args.organizationId);
  },
});
