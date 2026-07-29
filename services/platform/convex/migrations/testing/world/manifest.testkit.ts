/**
 * Registry of the baseline world corpus — a Tale deployment frozen at the
 * 0.4.0 migration baseline (`framework/baseline.ts`), i.e. a FRESH 0.4.0
 * deployment: current schema, current config shapes, empty migration
 * ledger. The chain harness seeds this corpus (DB rows via
 * `seed_db.testkit.ts`, config trees via `seed_fs.testkit.ts` from the
 * shipped `configs/platform/custom` catalog), runs `applyUp` through every
 * registered migration (none at the baseline — the suite is the harness the
 * first 0.4.x migration lands into), validates against the current schemas,
 * runs `applyDown` back to the baseline, and deep-compares against this
 * seed.
 *
 * Everything here is deterministic: fixed ids/slugs, the fixed
 * `WORLD_EPOCH_MS` timestamp base (see `seed_db.testkit.ts`) — never
 * `Date.now()` / `Math.random()` in seed values.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

/** The three corpus orgs. Slugs satisfy `isValidOrgSlug` (lib/shared/constants/org-slug). */
export const WORLD_ORGS = {
  /** Gets EVERY fixture: the org future migrations must transform end-to-end. */
  alpha: { slug: 'baseline-alpha', name: 'Baseline Alpha' },
  /** Small subset: the second datapoint for per-org node migrations. */
  beta: { slug: 'baseline-beta', name: 'Baseline Beta' },
  /** No rows, empty config dirs: every migration's per-org no-op path. */
  empty: { slug: 'baseline-empty', name: 'Baseline Empty' },
} as const;

export type WorldOrgKey = keyof typeof WORLD_ORGS;

/**
 * Tables that carry seeded rows at baseline (alpha always; beta a subset).
 * Everything else in the schema starts empty. A future migration whose
 * `subjects.tables` names an unlisted table extends the corpus (seed rows
 * here + `seed_db.testkit.ts`) or declares a producer/injection —
 * `check-migration-corpus` enforces it.
 */
export const baselineTables: string[] = [
  // Org structure + work items
  'projects',
  'tasks',
  'taskActivity',
  // Discussions (threadMetadata is the live discussion-thread container)
  'threadMetadata',
  // Chat (the 0.4 chat world)
  'threads',
  'messages',
  'generations',
  'memories',
  // Automations (the 0.4 automation store)
  'automations',
  'automationDeployments',
  'automationTriggers',
  'automationRuns',
  // External conversations + contacts
  'conversations',
  'conversationMessages',
  'contacts',
  // Documents & files
  'documents',
  'folders',
  'fileMetadata',
  // Credentials (strict rebuilt shapes)
  'connectorCredentials',
  'providerCredentials',
  // Per-user surfaces
  'userNotifications',
  'userPreferences',
  // Cross-cutting
  'approvals',
  'auditLogs',
  // Deferred drops (see convex/legacy/schema.ts): declared and forever EMPTY
  // on 0.4+ deployments — listed so their eventual drop migrations pass
  // corpus coverage; seed_db deliberately writes zero rows.
  'taskAgentRuns',
  'wfExecutions',
];

/**
 * Config-domain directories present on disk at baseline — exactly the
 * shipped per-org catalog (`configs/platform/custom`), which is what a
 * fresh 0.4.0 org is scaffolded with. `baseline-alpha` carries the full
 * catalog copy; `baseline-beta` a governance-only subset; `baseline-empty`
 * the empty domain dirs.
 */
export const baselineDomains: string[] = [
  'agents',
  'automations',
  'branding',
  'governance',
  'skills',
];

/**
 * Tables (empty at baseline) that gain rows mid-chain, keyed by the
 * migration whose `up` first populates them — the deep-compare must find
 * them EMPTY again after the full `applyDown`. Empty at the baseline reset:
 * the first 0.4.x migration that mints rows into a previously-empty table
 * registers itself here. `migrationLedger`/`migrationSnapshots` are
 * framework bookkeeping and never listed.
 */
export const produces: Record<string, string[]> = {
  // pins-to-bindings mints the junction rows from the retired scalar pin —
  // the table has no baseline seed because it did not exist at 0.4.0.
  '0.4.1/01_automation_pins_to_bindings': ['automationProjectBindings'],
};

/**
 * Deliberate corpus properties worth naming (consumed by humans and the
 * corpus smoke test, not by the runner):
 *
 * - `emptyOrgNoop` — `baseline-empty` seeds nothing anywhere, pinning every
 *   future migration's per-org no-op path.
 * - `deferredDropsEmpty` — `taskAgentRuns`/`wfExecutions` are listed in
 *   `baselineTables` but seeded with zero rows: 0.4+ deployments can never
 *   hold rows there, and the corpus must not invent any.
 */
export const profile = {
  emptyOrgNoop: true,
  deferredDropsEmpty: true,
} as const;
