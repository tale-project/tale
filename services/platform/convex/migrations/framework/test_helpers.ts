/**
 * Shared test scaffolding for migration round-trip tests.
 *
 *  - `historicalSchema` augments the production schema with legacy tables that
 *    were removed (e.g. `governancePolicies`) so a test can seed the OLD data
 *    shape, run a migration, and assert the result — `convex-test` validates
 *    against whatever schema it is given.
 *  - `buildModules` normalizes an `import.meta.glob` result (whose keys are
 *    relative to the TEST file) into the convex-root-relative keys `convexTest`
 *    expects. Each test passes its own glob + its own dir-from-convex-root
 *    because `import.meta.glob` must take a string literal.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { dsarPolicyPendingChangesTable } from '../../governance/schema';
import { configCacheTable } from '../../lib/config_cache/schema';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';

/**
 * The legacy `governancePolicies` table as it existed at v0.2.84, before
 * governance settings moved to per-org JSON files. Declared here (not in the
 * production schema) so the 0.2.85 governance migrations can be round-trip
 * tested.
 */
export const legacyGovernancePoliciesTable = defineTable({
  organizationId: v.string(),
  policyType: v.string(),
  config: v.any(),
  enabled: v.optional(v.boolean()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  effectiveAt: v.optional(v.number()),
  pendingConfig: v.optional(v.any()),
  pendingEffectiveAt: v.optional(v.number()),
  pendingProposedBy: v.optional(v.string()),
  pendingProposedByEmail: v.optional(v.string()),
  pendingProposedAt: v.optional(v.number()),
}).index('by_organizationId', ['organizationId']);

/**
 * The minimal schema the v0.2.85 governance migrations touch: the framework's
 * own ledger/snapshot tables, the configCache mirror, the new
 * dsarPolicyPendingChanges table, and the legacy governancePolicies table.
 * Kept minimal (rather than re-deriving the full production schema) because
 * `convexTest` only needs the tables a test actually reads/writes — and a
 * re-`defineSchema` over the spread production tables trips convex-test's table
 * export.
 */
export const historicalSchema = defineSchema({
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
  configCache: configCacheTable,
  dsarPolicyPendingChanges: dsarPolicyPendingChangesTable,
  governancePolicies: legacyGovernancePoliciesTable,
});

/** Normalize one glob key relative to the convex root, resolving `..`. */
function toConvexRootKey(dirFromRoot: string, globKey: string): string {
  const stack: string[] = [];
  for (const part of `${dirFromRoot}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * Convert an `import.meta.glob` result into the `{ 'path/from/convex/root': loader }`
 * map `convexTest` wants.
 *
 * @param rawModules result of `import.meta.glob('<…>/**\/*.*s')` in the test file
 * @param dirFromRoot the test file's directory relative to `convex/`
 */
export function buildModules(
  rawModules: Record<string, () => Promise<unknown>>,
  dirFromRoot: string,
): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const [key, loader] of Object.entries(rawModules)) {
    modules[toConvexRootKey(dirFromRoot, key)] = loader;
  }
  return modules;
}
