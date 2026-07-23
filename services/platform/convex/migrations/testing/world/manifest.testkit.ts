/**
 * Registry of the baseline world corpus — a Tale deployment frozen at v0.2.84,
 * the state immediately BEFORE the first runnable migration. The chain harness
 * seeds this corpus (DB rows via `seed_db.testkit.ts`, config trees via
 * `seed_fs.testkit.ts` from `tests/fixtures/migrations-world/config/`), runs
 * `applyUp` through all 37 runnable migrations to 0.3.4, validates against the
 * current schemas, runs `applyDown` back to 0.2.84, and deep-compares against
 * this seed.
 *
 * Everything here is deterministic: fixed ids/slugs, the fixed
 * `WORLD_EPOCH_MS` timestamp base (see `seed_db.testkit.ts`), and pre-computed
 * ciphertext constants — never `Date.now()` / `Math.random()` in seed values.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

/** The three corpus orgs. Slugs satisfy `isValidOrgSlug` (lib/shared/constants/org-slug). */
export const WORLD_ORGS = {
  /** Gets EVERY fixture: the org the chain must transform end-to-end. */
  alpha: { slug: 'baseline-alpha', name: 'Baseline Alpha' },
  /** Small subset: a second datapoint for per-org node migrations (0.2.98/02)
   *  and the org-level rename migrations (0.3.4/13, 0.3.4/16). */
  beta: { slug: 'baseline-beta', name: 'Baseline Beta' },
  /** No rows, empty config dirs: every migration's per-org no-op path. */
  empty: { slug: 'baseline-empty', name: 'Baseline Empty' },
} as const;

export type WorldOrgKey = keyof typeof WORLD_ORGS;

/**
 * Tables that carry seeded rows at baseline (alpha always; beta a subset).
 * Everything else in `world_schema.testkit.ts` starts empty and is populated
 * mid-chain (see {@link produces}) or is a framework/derived table.
 */
export const baselineTables: string[] = [
  'governancePolicies', // 0.2.85/01 exports, /02 splits pending*, /03 drops
  'orgPackagePolicy', // 0.2.87/02 exports, /04 drops
  'modelSyncSettings', // 0.2.87/03 exports, /05 drops
  'ssoProviders', // 0.2.87/01 exports to governance/sso files
  'projects', // stable FK holder for bindings + schedules
  'wfSchedules', // 0.2.96/02 assigns projectId; 0.3.4/09 reads
  'wfEventSubscriptions', // 0.3.4/12 adds the status_changed sibling
  'wfInstallations', // survivor workflow's installation (0.3.4/06 sweep)
  'threadFiles', // 0.2.96/03 rewrites relative → absolute paths
  'threadMetadata', // chat survivor only; app-era rows arrive via injection
  'conversations', // 0.3.4/01 backfills integrationName; 0.3.4/24 contactId
  'conversationMessages', // 0.3.4/01's derivation source
  'customers', // 0.3.4/23 copies into contacts
  'vendors', // 0.3.4/22 copies into contacts
  'userNotifications', // the 0.2.84-valid task_assigned survivor
  'integrationCredentials', // 0.3.4/02 reads (inactive row → install no-op)
  'messageMetadata', // 0.3.7/01 backfills organizationId from threadMetadata
  'reasoningProfiles', // 0.4.0/03 drains (born 0.2.79)
  'modelCapabilityCache', // 0.4.0/04 drains (born 0.2.84)
  'modelCatalogSync', // 0.4.0/05 drains (born 0.2.84)
  'autoRouteCache', // 0.4.0/06 drains (born ≤0.2.84)
  'mcpServers', // 0.4.0/07 drains (born ≤0.2.84)
  'skillUploadClaims', // 0.4.0/08 drains (born ≤0.2.84)
  'skillUploadIntents', // 0.4.0/09 drains (born ≤0.2.84)
  'slackEventDedup', // 0.4.0/10 drains (born ≤0.2.84)
  'slackInstallations', // 0.4.0/11 drains (born ≤0.2.84)
  'ttsGcCursor', // 0.4.0/12 drains (born ≤0.2.84)
  'wfApiKeys', // 0.4.0/13 drains (born ≤0.2.84)
  'wfWebhooks', // 0.4.0/14 drains (born ≤0.2.84)
  'workflowProcessingRecords', // 0.4.0/15 drains (born ≤0.2.84)
  'promptTemplates', // 0.4.0/30 exports to skills/<slug>/SKILL.md (born ≤0.2.84)
];

/**
 * Config-domain directories present on disk at baseline (the 0.2.84-era
 * domain set — `automations/`, `skills/`, `token-sources/` arrived later; the
 * app bundles of that era lived under `apps/`). `baseline-empty` mirrors this
 * exact set with all dirs empty; `baseline-beta` carries the same set MINUS
 * `branding/` (the 0.3.4/21 missing-dir no-op path, like the spike's org2).
 * The `workflows/` dir MUST exist even when empty so 0.3.4/06-down's
 * `listCatalogArea` doesn't ENOENT into a scheduler retry.
 */
export const baselineDomains: string[] = [
  'agents', // 0.2.98/01, 0.2.98/02, 0.3.4/04 walk/rewrite it
  'apps', // legacy issue-desk bundle tree (0.3.4/11's layout)
  // Present EMPTY at baseline (.gitkeep) as coverage ballast for 0.3.4/33's
  // domain subject: the dir is born mid-chain in real orgs (installs create
  // it; 33's seedDomain seeds it), and an empty dir is invisible to every
  // era's config validation.
  'automations',
  'branding', // 0.3.4/21 merges brandColor → accentColor
  'governance', // 0.2.85/01, 0.2.87/02+03 write INTO it; 0.3.4/03 deletes from it
  'integrations', // empty ballast (no chain migration touches it)
  'prompts', // ballast (no chain migration touches the prompts domain)
  'providers', // 0.2.98/01 appends the Fable catalog entries; 0.4.0/02 reads
  // Present EMPTY at baseline (.gitkeep), like `automations`: the domain was
  // born mid-chain (the retired token-sources feature), and 0.4.0/02 declares
  // it as a subject — its populated path is covered by the migration's own
  // test; an empty dir is invisible to every era's config validation.
  'token-sources',
  // Present EMPTY at baseline (.gitkeep), like `automations`: the domain is
  // born when an org gets its first skill, and 0.4.0/30 declares it as a
  // subject — the chain exercises its POPULATED path, since 30's export
  // writes alpha's and beta's prompt bundles into it and its down restores
  // the empty dir. An empty dir is invisible to every era's config
  // validation, and a SKILL.md is not a `.json` any era schema claims.
  'skills',
  'workflows', // 0.3.4/06 removes the retired file; down re-syncs the dir
];

/*
 * Version-boundary injections live in `injections.testkit.ts`: rows whose
 * tables/shapes were born AFTER 0.2.84 — appUploadClaims, appUploadIntents,
 * supportCases (v0.2.96) and the app-era threadMetadata rows (dev-only). The
 * versions suite seeds them when its walk crosses `afterVersion`; chains
 * A/B/C run without them (their consuming migrations are covered by their
 * own tests + the versions suite). NOT re-exported here: `support.ts` imports
 * this manifest into the push bundle, and a runtime re-export would drag
 * `injections.testkit.ts`'s `node:*`/fs-reading world into the isolate bundle
 * and break the Convex push (testkit.test.ts guards the closure) — consumers
 * import `WORLD_INJECTIONS` from `./injections.testkit` directly.
 */

/**
 * Tables (empty at baseline) that gain rows mid-chain, keyed by the migration
 * whose `up` first populates them — the deep-compare must find them EMPTY
 * again after the full `applyDown`. `migrationLedger` (every migration) and
 * `migrationSnapshots` (every `table-rows`/`fs-tree` snapshot) are framework
 * bookkeeping and intentionally not repeated per entry.
 */
export const produces: Record<string, string[]> = {
  // File→cache sync fills the governance mirror once files exist.
  '0.2.85/01_governance_db_to_json': ['configCache'],
  // Splits each governance row's staged DSAR change into its own table.
  '0.2.85/02_dsar_pending_table_split': ['dsarPolicyPendingChanges'],
  // Writes governance/sso/connection*.json + syncs the sso configCache domain.
  '0.2.87/01_enterprise_sso_unify': ['configCache'],
  // run-code.json export re-syncs the governance configCache domain.
  '0.2.87/02_run_code_policy_db_to_json': ['configCache'],
  // model-sync.json export re-syncs the governance configCache domain.
  '0.2.87/03_model_sync_db_to_json': ['configCache'],
  // Inserts the task.status_changed sibling ROW (table already seeded).
  '0.3.4/12_triage_backlog_start_trigger': ['wfEventSubscriptions'],
  // appInstallations rows move to the renamed table.
  '0.3.4/16_app_installations_table': ['automationInstallations'],
  // appProjectBindings rows move to the renamed table.
  '0.3.4/17_app_project_bindings_table': ['automationProjectBindings'],
  // appUploadClaims rows move to the renamed table.
  '0.3.4/18_app_upload_claims_table': ['automationUploadClaims'],
  // appUploadIntents rows move to the renamed table.
  '0.3.4/19_app_upload_intents_table': ['automationUploadIntents'],
  // Vendor rows are copied into contacts (with a __migratedFrom stamp).
  '0.3.4/22_backfill_contacts_from_vendors': ['contacts'],
  // Customer rows are copied into contacts (minus the status enum).
  '0.3.4/23_backfill_contacts_from_customers': ['contacts'],
  // Retired provider auth files + token sources become credential rows
  // (alpha's providers/openrouter.secrets.json feeds the in-chain datapoint).
  '0.4.0/02_provider_credentials_from_files': ['providerCredentials'],
};

/**
 * Documented corpus decisions — each one names the consuming migration and the
 * code-grounded reason. These are the deliberate gaps a chain-harness
 * follow-up would have to lift.
 */
export const profile = {
  /**
   * 0.3.4/02 install_email_apps: chain-runs as a per-org no-op. One INACTIVE
   * outlook credential is seeded so `credential_queries.listInternal` returns
   * a row and the active-filter (`isActive && status === 'active'`) is
   * exercised, but no ACTIVE email credential exists, so no automation install
   * runs (the install path needs the builtin automation catalog on disk and is
   * covered by the migration's own test).
   */
  emailCredentialsActive: false,
  /**
   * 0.3.4/11 retire_issue_desk: chain-runs as a per-org no-op — its
   * `getAutomationInstallationInternal` reads the CURRENT
   * `automationInstallations` table, which is only populated later by
   * 0.3.4/16. The legacy `apps/issue-desk/` config tree is still seeded (the
   * tree round-trips untouched); the issue-desk `appInstallations` row is
   * injected at the 0.2.85 boundary, so the renames get their real issue-desk
   * datapoint in the versions suite. The retire path is covered by the
   * migration's own (fully faked-ctx) test.
   */
  issueDeskRetireChainNoop: true,
  /**
   * NO `config` is seeded on `appInstallations`/`appProjectBindings`, and the
   * reconcile schedule's `variables` carry none of 0.3.4/09's CONFIG_KEYS
   * (owner/repo/testCommand/repoNotes). The 0.2.96/01 → 0.3.4/09 pair is not
   * round-trip composable in a full chain: 0.3.4/09's `up` clears the
   * org-level install config that no `down` ever restores, its `down`
   * materializes schedule CONFIG_KEYS onto configless bindings (the "accepted
   * edge case" in its source), and a leftover `config` would fail
   * current-schema validation when 0.3.4/17 copies rows into
   * `automationProjectBindings`. Copy/fold paths are covered by those
   * migrations' own tests. CHAIN-HARNESS FOLLOW-UP if config coverage is
   * wanted in-chain.
   */
  appConfigSeeded: false,
  /**
   * 0.2.96/03 thread_files_absolute_paths: only RELATIVE paths are seeded.
   * Its `down` strips `/user/<root>/` from ANY absolute row, so a seeded
   * already-absolute row (the idempotency edge) cannot round-trip; that edge
   * is covered by the migration's own test.
   */
  threadFilePathsRelativeOnly: true,
  /**
   * 0.3.4/06 remove_retired_task_workflows: the retired workflow file
   * (`projects/tasks/send-daily-digest.json`) is seeded WITHOUT
   * `metadata.autoInstall` and without installation/trigger/provision rows.
   * Its `down` re-runs `syncDefaultWorkflowInstallations`, which re-provisions
   * un-marked autoInstall files with wall-clock stamps
   * (installedAt/provisionedAt/createdAt) that would break the seed↔down
   * deep-compare. The row-deletion path is covered by the migration's own
   * test; the file removal + fs-tree restore ARE exercised in-chain.
   */
  retiredWorkflowAutoInstall: false,
  /**
   * The SURVIVOR workflow (`projects/tasks/triage-unassigned-tasks.json`)
   * carries NO `metadata.autoInstall`, so 0.3.4/06-down's provisioner has
   * nothing to (re-)provision and cannot mint wall-clock rows into the chain
   * deep-compare. Its `wfInstallations` row is baseline; the
   * `wfDefaultProvisions` marker (a v0.2.85-born table) is injected at that
   * boundary and must round-trip untouched. The provisioner's
   * skip-already-provisioned path is covered by the migration's own test.
   */
  survivorWorkflowProvisionMarker: true,
  /**
   * 0.3.3/01 normalize_auth_user_emails: no Better Auth USERS are seeded —
   * `support.seedAuthOrgs` (the only sanctioned component write) creates
   * organizations only. The component migration chain-runs as an empty-batch
   * no-op; its behaviour is covered by its own test. CHAIN-HARNESS FOLLOW-UP:
   * needs a sanctioned user-seeding support function.
   */
  authUsersSeeded: false,
  /**
   * `configCache` is seeded EMPTY: it is a derived mirror. 0.2.85/01,
   * 0.2.87/01–03 populate it on the way up; the same syncs clear it on the way
   * down (the governance dir ends holding no known policy files).
   */
  configCacheSeeded: false,
  /**
   * 0.2.87/01 enterprise_sso_unify: `clientIdEncrypted`/`clientSecretEncrypted`
   * are pre-computed compact-JWE constants under `WORLD_ENCRYPTION_SECRET_HEX`
   * (see `seed_db.testkit.ts`) — JWE encryption uses a random IV, so
   * encrypting at seed time would break byte-level determinism.
   */
  ssoSecretsFixedJwe: true,
  /**
   * The destructive `table-rows` migrations (0.2.85/03, 0.2.87/04, 0.2.87/05,
   * 0.3.4/05, 0.3.4/07) restore rows on `down` via insert — restored rows
   * get NEW `_id`/`_creationTime`. The deep-compare must normalize system
   * fields (and treat `storageId` values as opaque).
   */
  snapshotRestoreAssignsNewIds: true,
  /**
   * 0.2.98/01 claude_code_fable_default rewrites the alpha claude-code agent
   * pin and openrouter provider catalog IN PLACE (`snapshot: 'none'`), so the
   * round-tripped bytes are `serialize(parse(original))`. `seedWorldFs`
   * canonicalizes those two seeded files through the same parse/serialize the
   * migration uses (the checked-in fixtures carry the repo formatter's style,
   * which is not that fixpoint) — diff the SEEDED tree, not the fixture dir.
   */
  canonicalizedSeedFiles: true,
} as const;

/**
 * The index rename list (see `world_schema.testkit.ts` header): places where
 * history used ONE index name with DIFFERENT field lists, so the world schema
 * declares the later shape under a NEW name and the named migration must be
 * ported to that name to run against `worldSchema`.
 */
export const indexPortNotes = [
  {
    table: 'appInstallations',
    historicalName: 'by_org_slug',
    historicalFields: ['organizationId', 'appSlug'], // kept — 0.2.96/01, 0.2.96/02, 0.3.4/09 `up`
    worldName: 'by_org_automation_slug',
    worldFields: ['organizationId', 'automationSlug'],
    portIn: ['0.3.4/16_app_installations_table (down)'],
  },
  {
    table: 'appProjectBindings',
    historicalName: 'by_org_slug_project',
    historicalFields: ['organizationId', 'appSlug', 'projectId'], // kept — 0.2.96/02 `up`
    worldName: 'by_org_automation_slug_project',
    worldFields: ['organizationId', 'automationSlug', 'projectId'],
    portIn: ['0.3.4/17_app_project_bindings_table (down)'],
  },
] as const;

/**
 * Sibling rename migrations checked for the same conflict and found CLEAN
 * (same index name + same field list on both the legacy and renamed table).
 */
export const indexPortCheckedClean = [
  '0.3.4/18_app_upload_claims_table (by_org_slug = [organizationId, slug])',
  '0.3.4/19_app_upload_intents_table (by_storageId = [storageId])',
] as const;
