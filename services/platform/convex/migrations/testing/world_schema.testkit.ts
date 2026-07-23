/**
 * Union "world schema" for the full-chain migration harness (0.2.84 → 0.3.4 →
 * 0.2.84). One schema that every runnable migration's reads/writes validate
 * against, absorbing and extending `framework/test_helpers.historicalSchema`:
 *
 *  - CURRENT tables come from the per-feature schema modules (same imports
 *    `historicalSchema` uses), so they can't drift from production.
 *  - LEGACY tables (dropped from the production schema) are reused from
 *    `test_helpers` where its shape survives the whole chain, and re-declared
 *    here as wider unions where it does not (a field the chain renames must be
 *    optional in BOTH spellings — e.g. `appInstallations.appSlug` becomes
 *    `automationSlug` mid-chain via 0.3.4/13, so both are optional here).
 *
 * INDEX RENAME RULE — convex-test enforces index name AND field list, and two
 * points in history used the SAME index name with DIFFERENT fields:
 *
 *  - `appInstallations.by_org_slug` was ['organizationId','appSlug'] at 0.2.88
 *    (used by 0.2.96/01, 0.2.96/02, 0.3.4/09), but 0.3.4/16's `down` queries
 *    the same name as ['organizationId','automationSlug']. Declared here as
 *    `by_org_slug` (0.2.88 shape) plus `by_org_automation_slug` (93/04 shape);
 *    0.3.4/16's `down` must be ported to `by_org_automation_slug` when run
 *    against this schema (see `world/manifest.testkit.ts#indexPortNotes`).
 *  - `appProjectBindings.by_org_slug_project` has the same conflict between
 *    0.2.96/02 (['organizationId','appSlug','projectId']) and 0.3.4/17's
 *    `down` (['organizationId','automationSlug','projectId']) → declared as
 *    `by_org_slug_project` plus `by_org_automation_slug_project`.
 *  - Checked, NOT conflicted: 0.3.4/18 (`appUploadClaims.by_org_slug` is
 *    ['organizationId','slug'] on both sides — the field kept its name) and
 *    0.3.4/19 (`appUploadIntents.by_storageId`).
 *
 * Two-dot basename (`world_schema.testkit.ts`) keeps this module out of the
 * Convex push bundle; it must still never import vitest/convex-test — only
 * `convex/server`, `convex/values`, and app schema modules.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { userNotificationsTable } from '../../collab/schema';
import { contactsTable } from '../../contacts/schema';
import {
  conversationMessagesTable,
  conversationsTable,
} from '../../conversations/schema';
import {
  ssoConnectionsTable,
  ssoProvisioningLinksTable,
} from '../../enterprise_sso/schema';
import { dsarPolicyPendingChangesTable } from '../../governance/schema';
import { integrationCredentialsTable } from '../../integration_credentials/schema';
import {
  agentInstallationsTable,
  automationInstallationsTable,
  automationProjectBindingsTable,
  automationUploadClaimTable,
  automationUploadIntentTable,
  chatTypeValidator,
  messageMetadataTable,
  threadFilesTable,
  threadStatusValidator,
  wfDefaultProvisionsTable,
  wfEventSubscriptionsTable,
  wfInstallationsTable,
  wfSchedulesTable,
  workflowEnvTable,
} from '../../legacy/schema';
import { configCacheTable } from '../../lib/config_cache/schema';
import { jsonRecordValidator } from '../../lib/validators/json';
import { projectsTable } from '../../projects/schema';
import { promptTemplatesTable } from '../../prompts/schema';
import { providerCredentialsTable } from '../../provider_credentials/schema';
import { ssoProvidersTable } from '../../sso_providers/schema';
import { supportCasesTable } from '../../support_cases/schema';
import {
  migrationLedgerTable,
  migrationSnapshotsTable,
} from '../framework/schema';
import {
  legacyAgentDefaultProvisionsTable,
  legacyAgentEnvTable,
  legacyAgentJobsTable,
  legacyAgentRunCountersTable,
  legacyAgentRuntimesTable,
  legacyAgentTaskMetricsDailyTable,
  legacyAutoRouteCacheTable,
  legacyChatMessageQueueTable,
  legacyCustomersTable,
  legacyExternalRunsTable,
  legacyGovernancePoliciesTable,
  legacyMcpServersTable,
  legacyModelCapabilityCacheTable,
  legacyModelCatalogSyncTable,
  legacyModelSyncSettingsTable,
  legacyOrgPackagePolicyTable,
  legacyReasoningProfilesTable,
  legacySkillUploadClaimTable,
  legacySkillUploadIntentTable,
  legacySlackEventDedupTable,
  legacySlackInstallationsTable,
  legacyTtsGcCursorTable,
  legacyVendorsTable,
  legacyWfApiKeysTable,
  legacyWfWebhooksTable,
  legacyWorkflowProcessingRecordsTable,
} from '../framework/test_helpers';

/**
 * Legacy `appInstallations` as a CHAIN union (0.2.84 → 0.3.4/16). Diverges
 * from `test_helpers.legacyAppInstallationsWithConfigTable` on purpose: there
 * `appSlug` is required, which rejects the mid-chain state after 0.3.4/13
 * patches rows to `automationSlug: …, appSlug: undefined` while they still
 * live in this table. Both spellings are optional here, and the renamed
 * `by_org_automation_slug` index carries 0.3.4/16's `down` lookup (see the
 * header's index rename rule).
 */
export const worldAppInstallationsTable = defineTable({
  organizationId: v.string(),
  /** Pre-0.3.4/13 spelling; unset after the rename migration's `up`. */
  appSlug: v.optional(v.string()),
  appName: v.optional(v.string()),
  /** Post-0.3.4/13 spelling; unset at baseline. */
  automationSlug: v.optional(v.string()),
  automationName: v.optional(v.string()),
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
  /** Retired org-level `requires.config` values (cleared by 0.3.4/09). */
  config: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  // 0.2.88-era shape — used by 0.2.96/01, 0.2.96/02, 0.3.4/09 `up`.
  .index('by_org_slug', ['organizationId', 'appSlug'])
  // 0.3.4/16 `down` shape under a NEW name (rename rule; see header).
  .index('by_org_automation_slug', ['organizationId', 'automationSlug']);

/**
 * Legacy `appProjectBindings` as a CHAIN union (0.2.84 → 0.3.4/17). Same
 * divergence rationale as {@link worldAppInstallationsTable}: 0.3.4/14
 * renames `appSlug` → `automationSlug` in place, and 0.3.4/17's `down` needs
 * the automation-slug index spelling under a new name.
 */
export const worldAppProjectBindingsTable = defineTable({
  organizationId: v.string(),
  /** Pre-0.3.4/14 spelling; unset after the rename migration's `up`. */
  appSlug: v.optional(v.string()),
  /** Post-0.3.4/14 spelling; unset at baseline. */
  automationSlug: v.optional(v.string()),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
  /** Retired per-project config (copied by 0.2.96/01, cleared by 0.3.4/09). */
  config: v.optional(jsonRecordValidator),
})
  .index('by_project', ['projectId'])
  // 0.2.88-era shape — prefix-queried by 0.2.96/02 `up`.
  .index('by_org_slug_project', ['organizationId', 'appSlug', 'projectId'])
  // 0.3.4/17 `down` shape under a NEW name (rename rule; see header).
  .index('by_org_automation_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ]);

/**
 * Legacy `appUploadClaims` (renamed to `automationUploadClaims` by 0.3.4/18).
 * Field names never changed, so the single `by_org_slug` index serves both the
 * 0.3.4/18 `up` duplicate-check and its `down` re-insert lookup.
 */
export const legacyAppUploadClaimsTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

/**
 * Legacy `appUploadIntents` (renamed to `automationUploadIntents` by
 * 0.3.4/19). Field names never changed; `by_storageId` serves both sides.
 */
export const legacyAppUploadIntentsTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);

/**
 * `threadMetadata` as a CHAIN union. The production table
 * (`threads/schema.ts`) no longer admits the pre-0.2.93 discussion spelling —
 * `kind: 'app_discussion'` and the `appSlug` column — which 0.3.4/15 and
 * 0.3.4/20 rewrite. Declared locally with only the columns the corpus seeds
 * and the two migrations touch (plus the org column the smoke test filters
 * on); the old and new spellings are both optional, `historicalSchema` style.
 */
export const worldThreadMetadataTable = defineTable({
  threadId: v.string(),
  userId: v.string(),
  chatType: chatTypeValidator,
  status: threadStatusValidator,
  createdAt: v.number(),
  organizationId: v.optional(v.string()),
  title: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  /** Union of the current kinds plus the legacy `app_discussion` (0.3.4/20). */
  kind: v.optional(
    v.union(
      v.literal('chat'),
      v.literal('project_discussion'),
      v.literal('task_discussion'),
      v.literal('automation_discussion'),
      v.literal('app_discussion'),
    ),
  ),
  /** Pre-0.3.4/15 spelling; unset after the rename migration's `up`. */
  appSlug: v.optional(v.string()),
  /** Post-0.3.4/15 spelling; unset at baseline. */
  automationSlug: v.optional(v.string()),
  /** `'app'` at baseline; rewritten to `'automation'` by 0.3.4/15. */
  subjectType: v.optional(v.string()),
  subjectId: v.optional(v.string()),
})
  .index('by_threadId', ['threadId'])
  .index('by_organizationId', ['organizationId']);

/**
 * Every table any runnable migration (or an internal function a node
 * migration calls) reads or writes across the 0.2.85 → 0.3.4 chain, plus the
 * framework's own tables. Current shapes are imported from the per-feature
 * schema modules; legacy shapes come from `test_helpers` or the union defs
 * above. `convex-test` validates every insert/patch against this schema, so a
 * corpus row that would not have existed at its era fails the seed loudly.
 */
export const worldSchema = defineSchema({
  // --- framework -----------------------------------------------------------
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
  configCache: configCacheTable,

  // --- 0.2.85 governance cutover -------------------------------------------
  governancePolicies: legacyGovernancePoliciesTable,
  dsarPolicyPendingChanges: dsarPolicyPendingChangesTable,

  // --- 0.2.87 SSO unify + run_code/model_sync cutover -----------------------
  ssoProviders: ssoProvidersTable,
  ssoConnections: ssoConnectionsTable,
  ssoProvisioningLinks: ssoProvisioningLinksTable,
  orgPackagePolicy: legacyOrgPackagePolicyTable,
  modelSyncSettings: legacyModelSyncSettingsTable,

  // --- app/automation story (0.2.88, 0.2.91, 0.2.92, 0.2.93) ----------------
  projects: projectsTable,
  appInstallations: worldAppInstallationsTable,
  appProjectBindings: worldAppProjectBindingsTable,
  appUploadClaims: legacyAppUploadClaimsTable,
  appUploadIntents: legacyAppUploadIntentsTable,
  automationInstallations: automationInstallationsTable,
  automationProjectBindings: automationProjectBindingsTable,
  automationUploadClaims: automationUploadClaimTable,
  automationUploadIntents: automationUploadIntentTable,

  // --- workflow triggers + default-pack provisioning (0.2.96/02, 0.3.4/06,
  // --- 0.3.4/12) -----------------------------------------------------------
  wfSchedules: wfSchedulesTable,
  wfEventSubscriptions: wfEventSubscriptionsTable,
  wfInstallations: wfInstallationsTable,
  workflowEnv: workflowEnvTable,
  wfDefaultProvisions: wfDefaultProvisionsTable,

  // --- 0.2.89 ---------------------------------------------------------------
  threadFiles: threadFilesTable,

  // --- 0.2.90 ---------------------------------------------------------------
  // The production def still carries the transitional `customerId` (see the
  // pre-drop comment in `conversations/schema.ts`); the corpus and 0.3.4/24+27
  // rely on it. When the contract phase finally drops it there, this mapping
  // needs a chain-union twin restoring the field (same for `supportCases`).
  conversations: conversationsTable,
  conversationMessages: conversationMessagesTable,
  // --- 0.4.0/23 integration-credential carry-over ---------------------------
  // The production table already admits BOTH shapes (its own transitional
  // union), so the chain reuses it rather than re-declaring the retired
  // columns here — one source, no drift.
  integrationCredentials: integrationCredentialsTable,
  agentInstallations: agentInstallationsTable,
  userNotifications: userNotificationsTable,

  // --- 0.2.93 threadMetadata renames ----------------------------------------
  threadMetadata: worldThreadMetadataTable,

  // --- 0.3.4 contacts merge --------------------------------------------------
  contacts: contactsTable,
  customers: legacyCustomersTable,
  vendors: legacyVendorsTable,
  supportCases: supportCasesTable,

  // --- 0.3.7 message-metadata org backfill ----------------------------------
  // messageMetadata predates the baseline (v0.2.84) but is only now exercised
  // by the chain — 0.3.7/01 backfills its new optional `organizationId` from
  // the owning thread. Production shape imported directly (no chain rename); the
  // optional org field validates for pre-0.3.7 rows (absent) and post-up rows.
  messageMetadata: messageMetadataTable,

  // --- 0.4.0 prompt library → skill files -----------------------------------
  // Seeded at baseline (the table predates v0.2.84 and its required column set
  // is identical in every checkpoint through 0.4.0). 0.4.0/30 READS it and
  // writes skill files; the rows themselves are never touched, so the
  // production shape is imported directly.
  promptTemplates: promptTemplatesTable,

  // --- 0.4.0 provider credentials -------------------------------------------
  // Empty at baseline; 0.4.0/02 converts the retired providers/ +
  // token-sources/ config files into rows and its down empties the table
  // again. Production shape imported directly (the table was born current).
  providerCredentials: providerCredentialsTable,

  // --- 0.4.0 retired provider cache/governor drops (0.4.0/03–/05) -----------
  // Seeded at baseline (all three predate or coincide with v0.2.84) and
  // drained by the drop migrations; their era shapes live in test_helpers —
  // the production schema no longer declares them.
  reasoningProfiles: legacyReasoningProfilesTable,
  modelCapabilityCache: legacyModelCapabilityCacheTable,
  modelCatalogSync: legacyModelCatalogSyncTable,

  // --- 0.4.0 retired AI-backend table drops (0.4.0/06–/22) ------------------
  // Seeded at baseline when the table predates or coincides with v0.2.84, else
  // injected at its birth release (see world/injections.testkit.ts), and
  // drained by the drop migrations. Era shapes live in test_helpers; the
  // production schema no longer declares them.
  autoRouteCache: legacyAutoRouteCacheTable,
  mcpServers: legacyMcpServersTable,
  skillUploadClaims: legacySkillUploadClaimTable,
  skillUploadIntents: legacySkillUploadIntentTable,
  slackEventDedup: legacySlackEventDedupTable,
  slackInstallations: legacySlackInstallationsTable,
  ttsGcCursor: legacyTtsGcCursorTable,
  wfApiKeys: legacyWfApiKeysTable,
  wfWebhooks: legacyWfWebhooksTable,
  workflowProcessingRecords: legacyWorkflowProcessingRecordsTable,
  agentDefaultProvisions: legacyAgentDefaultProvisionsTable,
  agentRunCounters: legacyAgentRunCountersTable,
  agentRuntimes: legacyAgentRuntimesTable,
  agentTaskMetricsDaily: legacyAgentTaskMetricsDailyTable,
  chatMessageQueue: legacyChatMessageQueueTable,
  externalRuns: legacyExternalRunsTable,
  agentJobs: legacyAgentJobsTable,
  // Injected at its 0.2.85 birth release and drained by 0.4.0/36: an agent
  // holds no credentials any more, so the per-agent env store is gone from
  // the production schema and its era shape lives in test_helpers.
  agentEnv: legacyAgentEnvTable,
});
