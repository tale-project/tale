/**
 * Shared test scaffolding for migration round-trip tests.
 *
 *  - The exported LEGACY TABLE definitions describe removed tables (e.g.
 *    `governancePolicies`) at their pre-migration shapes; the union
 *    `testing/world_schema.testkit.ts` assembles them (plus current tables)
 *    into the schema every migration test and the chain harness run against.
 *  - `buildModules` normalizes an `import.meta.glob` result (whose keys are
 *    relative to the TEST file) into the convex-root-relative keys `convexTest`
 *    expects. Each test passes its own glob + its own dir-from-convex-root
 *    because `import.meta.glob` must take a string literal.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { dataSourceValidator } from '../../lib/validators/common';
import { jsonRecordValidator } from '../../lib/validators/json';

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
 * The legacy `orgPackagePolicy` / `modelSyncSettings` tables as they existed at
 * v0.2.86, before the `run_code` / `model_sync` governance policies became
 * file-based. Declared here so the 0.2.87 cutover migrations can be round-trip
 * tested.
 */
export const legacyOrgPackagePolicyTable = defineTable({
  organizationId: v.string(),
  defaultMode: v.union(v.literal('allowlist'), v.literal('denylist')),
  pythonAllow: v.array(v.string()),
  pythonDeny: v.array(v.string()),
  nodeAllow: v.array(v.string()),
  nodeDeny: v.array(v.string()),
  updatedAt: v.optional(v.number()),
  updatedByUserId: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);

export const legacyModelSyncSettingsTable = defineTable({
  organizationId: v.string(),
  autoSyncEnabled: v.boolean(),
  updatedAt: v.optional(v.number()),
}).index('by_organizationId', ['organizationId']);

/**
 * Legacy `appInstallations`/`appProjectBindings` table names (pre-0.2.93 /04–/05)
 * as they existed through v0.2.90, before `config` (the automation manifest's
 * retired `requires.config` values) was dropped in the 0.2.91 config-to-schedule-variables
 * cutover. The live schema (`automations/schema.ts`) uses `automationInstallations` /
 * `automationProjectBindings`; these legacy-named tables remain here so 0.2.88/0.2.91
 * migration round-trip tests can seed the OLD (config-bearing) shape.
 */
export const legacyAppInstallationsWithConfigTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  appName: v.optional(v.string()),
  installedAt: v.number(),
  installedBy: v.string(),
  status: v.union(v.literal('active'), v.literal('broken')),
  uninstalling: v.optional(v.boolean()),
  requiredIntegrations: v.array(v.string()),
  resources: v.array(
    v.object({
      domain: v.string(),
      path: v.string(),
      contentHash: v.string(),
      adopted: v.optional(v.boolean()),
    }),
  ),
  config: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'appSlug']);

export const legacyAppProjectBindingsWithConfigTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
  config: v.optional(jsonRecordValidator),
})
  .index('by_project', ['projectId'])
  .index('by_org_slug_project', ['organizationId', 'appSlug', 'projectId']);

/**
 * Pre-0.3.4 `customers` + `vendors` tables, dropped in the Customers +
 * Vendors → Contacts merge (issue #2618). Declared here so the 0.3.4 backfill
 * migrations (22/23 contacts-from-{vendors,customers}) can seed the OLD
 * shape and round-trip. Minimal — only the fields those tests read/write.
 * The `customerId` link these tables' FK once pointed at (`conversations` /
 * `supportCases`) is restored as a chain-union field directly on
 * `worldConversationsTable` / `worldSupportCasesTable` in
 * `world_schema.testkit.ts` — those tables are otherwise identical to the
 * current production schema, so duplicating the FK there (not here) keeps
 * one definition per table shape.
 */
export const legacyCustomersTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(
    v.union(v.literal('active'), v.literal('churned'), v.literal('potential')),
  ),
  source: dataSourceValidator,
  locale: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
}).index('by_organizationId', ['organizationId']);

export const legacyVendorsTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: dataSourceValidator,
  locale: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);

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
