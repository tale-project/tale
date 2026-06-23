/**
 * V8 accessors for the legacy `orgPackagePolicy` and `modelSyncSettings` tables.
 * Both became file-based governance policies (`run_code`, `model_sync`); the
 * tables are gone from the production schema, but Convex still permits reading a
 * table that exists in the database yet is absent from the schema — exactly the
 * situation on an install upgrading across the 0.2.86 → 0.2.87 boundary. These
 * helpers centralise the untyped access so the v0.2.87 cutover migrations don't
 * each re-cast.
 *
 * Shared by:
 *  - 02_run_code_policy_db_to_json (node) — reads orgPackagePolicy rows → files
 *  - 03_model_sync_db_to_json      (node) — reads modelSyncSettings rows → files
 *  - 04_drop_org_package_policy    (db)   — drops rows after export
 *  - 05_drop_model_sync_settings   (db)   — drops rows after export
 */

import { v } from 'convex/values';

import { internalQuery } from '../../../_generated/server';

/** The legacy `orgPackagePolicy` row shape (only the fields migrations consume). */
export interface LegacyOrgPackagePolicyRow {
  _id: string;
  organizationId: string;
  defaultMode: 'allowlist' | 'denylist';
  pythonAllow: string[];
  pythonDeny: string[];
  nodeAllow: string[];
  nodeDeny: string[];
}

/** The legacy `modelSyncSettings` row shape. */
export interface LegacyModelSyncSettingsRow {
  _id: string;
  organizationId: string;
  autoSyncEnabled: boolean;
}

/** All legacy `orgPackagePolicy` rows for one org (`[]` when the table is gone). */
export const listOrgPackagePolicyByOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<LegacyOrgPackagePolicyRow[]> => {
    let rows: LegacyOrgPackagePolicyRow[];
    try {
      // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
      rows = (await (
        ctx.db.query('orgPackagePolicy' as any) as any
      ).collect()) as LegacyOrgPackagePolicyRow[];
    } catch (err) {
      console.warn(
        '[migration 0.2.87] orgPackagePolicy table not readable (likely already dropped):',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    return rows.filter((r) => r.organizationId === args.organizationId);
  },
});

/** All legacy `modelSyncSettings` rows for one org (`[]` when the table is gone). */
export const listModelSyncSettingsByOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<LegacyModelSyncSettingsRow[]> => {
    let rows: LegacyModelSyncSettingsRow[];
    try {
      // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
      rows = (await (
        ctx.db.query('modelSyncSettings' as any) as any
      ).collect()) as LegacyModelSyncSettingsRow[];
    } catch (err) {
      console.warn(
        '[migration 0.2.87] modelSyncSettings table not readable (likely already dropped):',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    return rows.filter((r) => r.organizationId === args.organizationId);
  },
});
