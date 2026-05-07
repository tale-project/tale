import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const GOVERNANCE_POLICY_TYPES = [
  'system_prompt',
  'budgets',
  'upload_policy',
  'retention_policy',
  'feature_flags',
  'pii_config',
  'default_models',
  'model_access',
  'login_policy',
  'password_policy',
  'two_factor_policy',
  'chat_filter',
  'moderation_provider',
  'personalization',
  // Phase 12 — admin-customizable confidentiality notice rendered in
  // chat composer + upload dialog footers. Default copy is fetched from
  // i18n; this policy lets per-org admins override per locale.
  'data_classification_notice',
] as const;

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

export const governancePoliciesTable = defineTable({
  organizationId: v.string(),
  policyType: policyTypeValidator,
  config: jsonRecordValidator,
  enabled: v.optional(v.boolean()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  // Timestamp at which the policy's active enforcement window began.
  // Used by password_policy rotation to grant a grace window: credential
  // expiry = max(passwordChangedAt, effectiveAt) + rotationDays. Set the
  // first time an enforcement-bearing field transitions to an active
  // value; preserved across unrelated edits.
  effectiveAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_org_policyType', ['organizationId', 'policyType']);

/**
 * Per-org encrypted secrets used by the guardrails pipeline. Deliberately a
 * separate table from `governancePolicies` so `upsertPolicy`'s audit log
 * (which snapshots the whole `config` into `previousState`/`newState`)
 * never touches these rows. The only currently-defined `name` is
 * `moderation_auth_header`; v2 may add more as the feature grows.
 *
 * `ciphertext`, `nonce`, and `authTag` are Base64 strings produced by
 * `lib/secret_box.ts`. `keyFingerprint` is the first 12 hex chars of
 * SHA-256(env key) — it lets us detect when the encryption key has been
 * rotated without trying to decrypt (old rows with mismatched fingerprint
 * return `null` to the caller rather than throwing).
 */
export const governanceSecretsTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  ciphertext: v.string(),
  nonce: v.string(),
  authTag: v.string(),
  keyFingerprint: v.string(),
  updatedAt: v.number(),
  updatedBy: v.string(),
}).index('by_org_name', ['organizationId', 'name']);

export const usageLedgerTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  teamId: v.optional(v.string()),
  periodKey: v.string(),
  // Granularity of periodKey (daily=YYYY-MM-DD, weekly=YYYY-Www, monthly=YYYY-MM).
  // Optional only for back-compat with legacy rows; backfilled at deploy.
  granularity: v.optional(
    v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly')),
  ),
  // Assistant / workflow step that produced the usage. Undefined for direct
  // model-API callers (openai-compat) and for legacy rows.
  agentSlug: v.optional(v.string()),
  // LLM model identifier, e.g. "gpt-4o-mini", "claude-opus-4-7". Undefined
  // for legacy rows only.
  model: v.optional(v.string()),
  // LLM provider, e.g. "openai", "anthropic". Stored for breakdown display;
  // not part of the dedup key (model uniquely determines provider).
  provider: v.optional(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  totalTokens: v.number(),
  costEstimate: v.number(),
  requestCount: v.number(),
  // Integration accounting — populated for rows that represent external-service
  // calls (e.g. Tavily search). integrationName is unique per provider so it
  // pairs with agentSlug for attribution. `model` is unset for integration rows.
  integrationName: v.optional(v.string()),
  integrationOperation: v.optional(v.string()),
  integrationCallCount: v.optional(v.number()),
  // Transcription accounting — populated for speech-to-text rows. Billed per
  // minute of audio rather than per token, so inputTokens/outputTokens are
  // always 0 and costEstimate is derived from audioDurationSec directly.
  audioDurationSec: v.optional(v.number()),
})
  .index('by_org_user_period', ['organizationId', 'userId', 'periodKey'])
  .index('by_org_user_period_team', [
    'organizationId',
    'userId',
    'periodKey',
    'teamId',
  ])
  .index('by_org_user_period_team_agent_model', [
    'organizationId',
    'userId',
    'periodKey',
    'teamId',
    'agentSlug',
    'model',
  ])
  .index('by_org_team_period', ['organizationId', 'teamId', 'periodKey'])
  .index('by_org_period', ['organizationId', 'periodKey'])
  .index('by_org_granularity_period', [
    'organizationId',
    'granularity',
    'periodKey',
  ]);

/**
 * Phase 8 — eDiscovery matter grouping.
 *
 * Multiple legal holds typically cluster around one case ("Alice v.
 * Company 2026"). The matter row gives counsel one handle to:
 *   - close out an entire case at once (release every linked hold)
 *   - filter the legal-hold UI by case number
 *   - export a chain-of-custody artefact per case (future)
 *
 * Holds without an explicit matter use the synthetic "default" matter
 * (created lazily); holds keyed to a real case use `legalHolds.matterRef`
 * pointing at this row's `_id`.
 */
export const legalMattersTable = defineTable({
  organizationId: v.string(),
  /** Free-text human-readable case name. */
  name: v.string(),
  /** Optional external case number / docket reference. */
  caseNumber: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.union(v.literal('open'), v.literal('closed')),
  createdBy: v.string(),
  createdAt: v.number(),
  closedBy: v.optional(v.string()),
  closedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_status', ['organizationId', 'status']);

/**
 * Phase 8 — dual-control release request.
 *
 * Releasing a legal hold is the high-risk operation: a malicious admin
 * can release + immediately delete to destroy evidence. Maker-checker
 * pattern: admin A files a release request; admin B (must be a
 * different user) approves; the release takes effect after a 24h
 * cooldown (env-tunable via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`)
 * giving compliance teams time to react if either admin was
 * compromised.
 *
 * Single-admin orgs: refuse release unless
 * `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` set. Loud audit warning when
 * used.
 */
export const legalHoldReleaseRequestsTable = defineTable({
  organizationId: v.string(),
  holdId: v.id('legalHolds'),
  requestedBy: v.string(),
  requestedAt: v.number(),
  reason: v.string(),
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('rejected'),
    v.literal('effected'),
  ),
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  /** ms since epoch when the release becomes effective (approval + cooldown). */
  effectiveAt: v.optional(v.number()),
  rejectedBy: v.optional(v.string()),
  rejectedAt: v.optional(v.number()),
  rejectReason: v.optional(v.string()),
})
  .index('by_holdId', ['holdId'])
  .index('by_organizationId_status', ['organizationId', 'status']);

/**
 * Legal hold (Phase 8) — preservation flag for compliance / eDiscovery.
 *
 * When a row exists for a (organizationId, targetType, targetId) tuple
 * AND `releasedAt === undefined`, the retention cleanup runner refuses
 * to physically delete the matching entity. The hold is **sticky**:
 * `restoreChatThread` also refuses while a hold is active.
 *
 * Target types:
 *   - `'thread'`        — a chat thread (and all its descendants by
 *                         cascade-protection: cleanup short-circuits
 *                         before recursing into children).
 *   - `'document'`      — a knowledge-hub document.
 *   - `'execution'`     — a workflow execution.
 *   - `'userMembership'`— protect everything authored by a given user
 *                         (not yet wired to enforcement; placeholder
 *                         for the custodian-hold pattern).
 *   - `'org'`           — protect every entity in the org (cleanup
 *                         skips the entire org's pass when present).
 *
 * Bundle 3 ships this minimum-viable shape:
 *   - place + release as separate mutations
 *   - `loadActiveHolds(ctx, orgId)` pre-fetched per cleanup run
 *   - cascade-protection in retention Pass B
 *
 * Deferred to a follow-up (per the v2 plan, intentionally scoped down):
 *   - dual-control approval flow on release (`legalHoldReleaseRequestsTable`)
 *   - matter grouping (`legalMattersTable`)
 *   - bulk place + custodian-resolve + UI search picker
 */
export const legalHoldsTable = defineTable({
  organizationId: v.string(),
  targetType: v.union(
    v.literal('thread'),
    v.literal('document'),
    v.literal('execution'),
    v.literal('userMembership'),
    v.literal('org'),
  ),
  /** _id (or threadId for `'thread'`) of the held entity. */
  targetId: v.string(),
  /** Required free-text from the placing admin. */
  reason: v.string(),
  /** Optional matter / case grouping. Stored as `String(matter._id)`
   *  so `closeLegalMatter`'s fan-out release can look up linked holds
   *  by matter id without an FK migration. `placeLegalHold` and
   *  `bulkPlaceLegalHold` validate the ref points at an existing
   *  `legalMatters` row in the same org before writing it. Indexed by
   *  `by_matterRef` to support fan-out release and per-matter views. */
  matterRef: v.optional(v.string()),
  placedBy: v.string(),
  placedAt: v.number(),
  /** When set, the hold is no longer active and the entity returns to
   *  normal retention semantics. Released holds are RETAINED for the
   *  audit trail — never physically deleted. */
  releasedAt: v.optional(v.number()),
  releasedBy: v.optional(v.string()),
  releaseReason: v.optional(v.string()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_targetType', ['organizationId', 'targetType'])
  .index('by_target', ['organizationId', 'targetType', 'targetId'])
  .index('by_organizationId_matterRef', ['organizationId', 'matterRef']);

/**
 * Audit-log integrity checkpoint (Phase 9).
 *
 * `audit_logs/internal_mutations.deleteOldLogs` (formerly
 * `archiveOldLogs`) hard-deletes rows past retention. Without a
 * checkpoint, the SHA-256 hash chain (audit_logs/helpers.ts) breaks
 * silently at the cutoff — pre-archive tampering becomes undetectable.
 *
 * Each checkpoint signs:
 *   - the chain's last `integrityHash` value as of the cleanup run
 *   - the count of rows deleted
 *   - the timestamp of the newest deleted row
 *
 * `verify_integrity.ts` walks checkpoint→checkpoint when the chain
 * starts with a previousHash whose row is gone, so tampering across
 * an archive boundary still surfaces as a mismatch.
 *
 * Bundle 3 ships the schema + cleanup writes a checkpoint row each
 * time it deletes; signing with a deploy-key is deferred to a
 * follow-up (today the checkpoint is unsigned but tamper-evident
 * because the chain hash itself is content-addressed).
 */
export const auditLogCheckpointsTable = defineTable({
  organizationId: v.string(),
  /**
   * Boundary type. `'retention'` (default for pre-bundle rows) marks a
   * cleanup-driven hard-delete cut. `'pii_scrub'` marks a GDPR Art 17
   * subject-scope scrub of in-place rows; the chain hashes diverge but
   * the verifier accepts the divergence when the corresponding
   * checkpoint signature validates.
   */
  subtype: v.optional(v.union(v.literal('retention'), v.literal('pii_scrub'))),
  /** SHA-256 hash of the last DELETED row's chain head. */
  lastDeletedHash: v.string(),
  /** SHA-256 hash of the first RETAINED row's previousHash field, so the
   *  retained chain can be re-anchored to this checkpoint. */
  firstRetainedPreviousHash: v.optional(v.string()),
  /** Newest `_creationTime` among deleted rows. */
  maxDeletedTimestamp: v.number(),
  /** Count of rows deleted in this batch. */
  deletedCount: v.number(),
  /** GDPR Art 17 fields, only populated when subtype === 'pii_scrub'. */
  scrubbedSubjectId: v.optional(v.string()),
  scrubbedRowCount: v.optional(v.number()),
  /** Set when bundle-3-follow-up wires the deploy-key signing. */
  signature: v.optional(v.string()),
  /**
   * Signature payload schema version.
   *
   * - `1` (or absent): legacy payload — `{organizationId, lastDeletedHash,
   *   firstRetainedPreviousHash, maxDeletedTimestamp, deletedCount}`. Bound
   *   neither `subtype` nor `scrubbedSubjectId`, so a captured retention
   *   HMAC could be replayed onto a forged `pii_scrub` checkpoint targeting
   *   any subject.
   * - `2`: payload also covers `subtype` and `scrubbedSubjectId`. Closes
   *   the cross-subtype/subject replay window.
   *
   * The verifier dispatches by version so old v1 checkpoints keep
   * verifying for the lifetime of the chain (audit chain is append-only
   * — re-signing history would itself be a tamper).
   */
  signatureVersion: v.optional(v.union(v.literal(1), v.literal(2))),
  createdAt: v.number(),
}).index('by_organizationId_createdAt', ['organizationId', 'createdAt']);

/**
 * Phase 12 — one-time acknowledgment of the data-classification notice.
 *
 * When the `data_classification_notice` policy has
 * `requireAcknowledgment: true`, every member must explicitly accept
 * the current notice once. Re-acknowledgment is forced when the org
 * admin bumps `version` (which itself happens automatically when the
 * notice text is edited).
 *
 * Querying: `(userId, organizationId, policyType)` → most-recent row.
 * If `policyVersion < currentVersion`, the modal re-fires.
 */
export const policyAcknowledgementsTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  policyType: v.string(),
  policyVersion: v.number(),
  acknowledgedAt: v.number(),
}).index('by_user_org_policy', ['userId', 'organizationId', 'policyType']);

/**
 * Phase 7 — retention run state.
 *
 * One row per (organizationId, runId) tracking the in-flight cleanup
 * pass. `runOrgRetentionCleanup` checks this BEFORE doing work — if
 * the most recent row for an org is < 23h old AND has no `completedAt`,
 * the new run skips (prevents duplicate-fire when the previous day's
 * run is still draining a backlog).
 *
 * `lastCursor` is a structured object capturing `(category, step?,
 * lastCreationTime?)` so a worker that hits the 25-min time budget
 * can self-schedule continuation with the cursor and pick up where it
 * left off — never restart from the top.
 *
 * `lastError` records any non-fatal error from the last category for
 * the operator UI to surface as a "retention had problems on org X"
 * banner.
 */
export const retentionRunsTable = defineTable({
  organizationId: v.string(),
  startedAt: v.number(),
  /** ms since epoch; set when the worker fully finishes every category. */
  completedAt: v.optional(v.number()),
  /** Cursor for resume on time-budget exhaustion or scheduled
   *  continuation. `category` lists which cleanup category to resume;
   *  `step` is the cascade child-table step inside chat-history;
   *  `lastCreationTime` is the resumption point inside that step. */
  lastCursor: v.optional(
    v.object({
      category: v.string(),
      step: v.optional(v.string()),
      lastCreationTime: v.optional(v.number()),
    }),
  ),
  lastError: v.optional(v.string()),
  /** Cumulative count of rows processed in this run — for telemetry. */
  processedCount: v.optional(v.number()),
  /** Updated each time `recordRetentionRunCheckpoint` advances; lets the
   *  stale-run reaper distinguish a still-working continuation from a
   *  truly crashed run without waiting the full 23h absolute timeout. */
  lastHeartbeatAt: v.optional(v.number()),
}).index('by_organizationId_startedAt', ['organizationId', 'startedAt']);

/**
 * Phase 3 — pending-change cooldown for retention shortening.
 *
 * When `upsertPolicy` REDUCES any `*RetentionDays` value, instead of
 * applying immediately a row is inserted here with `appliesAt = now +
 * cooldownMs`. Until `appliesAt`, the cleanup runner continues using
 * the OLD value (read from the `oldConfig` snapshot). After
 * `appliesAt`, the cooldown row is removed and the new value takes
 * effect on the next run.
 *
 * Rationale: if an attacker compromises an admin token, they can
 * shorten audit retention to its floor (365d) and immediately destroy
 * evidence. The cooldown gives ops/security teams a 7-30 day window
 * to notice + cancel the change before it bites.
 *
 * Admins can cancel a pending change via `cancelPendingRetentionChange`.
 */
export const retentionPolicyPendingChangesTable = defineTable({
  organizationId: v.string(),
  /** When the pending change becomes effective. Cleanup uses old config
   *  while now < appliesAt; uses new config and removes this row when
   *  now >= appliesAt. */
  appliesAt: v.number(),
  /** Snapshot of the previous-effective config so cleanup can keep
   *  using it during the cooldown window. */
  oldConfig: jsonRecordValidator,
  /** Snapshot of the new config that will take effect at appliesAt. */
  newConfig: jsonRecordValidator,
  requestedBy: v.string(),
  requestedAt: v.number(),
  /** Plain-language summary of which categories were shortened, for
   *  the admin UI banner + notification email. */
  summary: v.string(),
}).index('by_organizationId_appliesAt', ['organizationId', 'appliesAt']);

/**
 * Per-org snapshot of the retention bounds (`min`/`max`) that cleanup
 * currently enforces. Decouples runtime cleanup from the live JSON
 * file: file edits and env tightening become PROPOSALS, not directives.
 *
 * Detection: at query time (banner) or first-enable time, recompute
 * effective bounds from file + env, hash the canonical JSON, compare
 * against `appliedBoundsHash`. Mismatch ⇒ pending proposal.
 *
 * Banner gating rule:
 *   show ⇔ proposedHash ≠ appliedBoundsHash
 *        ∧ proposedHash ≠ rejectedBoundsHash
 *
 * Cleanup never reads the file for bounds — it reads `appliedBounds`.
 * If the row is absent for an org (pre-migration / pre-first-enable),
 * cleanup skips that org with a console warning.
 */
export const retentionAppliedBoundsTable = defineTable({
  organizationId: v.string(),
  /** Snapshot of effective bounds (post-env-tightening) keyed by
   *  `RetentionCategory`. Shape per category: `{min, max}`. Only the
   *  fields cleanup's `clampConfigToBounds` consumes are stored;
   *  display metadata stays in the file. */
  appliedBounds: jsonRecordValidator,
  /** SHA-256 hex of `JSON.stringify(canonicalize(appliedBounds))`.
   *  Canonicalization sorts category keys + field keys alphabetically
   *  so identical content always hashes the same regardless of
   *  insertion order. */
  appliedBoundsHash: v.string(),
  appliedAt: v.number(),
  appliedBy: v.string(),
  /** Most recently rejected proposal hash. Banner stays hidden while
   *  the operator's current effective hash matches this. Cleared
   *  whenever `appliedBoundsHash` changes (next reject starts fresh). */
  rejectedBoundsHash: v.optional(v.string()),
  rejectedAt: v.optional(v.number()),
  rejectedBy: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);

/**
 * GDPR Art 17 erasure request state machine.
 *
 * `requestErasure` inserts a row with `status='pending'` and schedules
 * `processErasureRequest`. The processor flips through
 * `running → done | partial | failed`, recording counts + the held-
 * threads list along the way. The row is the durable receipt the
 * subject can reference (Art 19 — confirmation of erasure).
 *
 * `targetUserId` may not equal the `requestedBy` admin (typical case:
 * an admin executes erasure on behalf of a verified subject). The
 * audit chain still records who clicked the button.
 *
 * Phases:
 *   - pending  → row inserted, processor not yet started
 *   - running  → processor picked it up
 *   - done     → every targeted resource cascaded successfully
 *   - partial  → some resources hit the page-cap; processor will
 *                resume on the next scheduled run
 *   - failed   → unrecoverable error (e.g. RAG service permanently
 *                unreachable); operator must inspect `errorMessage`
 *
 * `slaDeadlineAt = requestedAt + 30 days` per Art 12(3); operators
 * see overdue requests in the admin UI.
 */
export const gdprErasureRequestsTable = defineTable({
  organizationId: v.string(),
  targetUserId: v.string(),
  reason: v.string(),
  requestedBy: v.string(),
  requestedAt: v.number(),
  slaDeadlineAt: v.number(),
  status: v.union(
    v.literal('pending'),
    v.literal('running'),
    v.literal('done'),
    v.literal('partial'),
    v.literal('failed'),
  ),
  /** Snapshot of the threads list at request time. Processed
   *  iteratively; resume token if status='partial'. */
  threadsTargeted: v.optional(v.array(v.string())),
  threadsErased: v.optional(v.number()),
  /** Held threads that BLOCKED the erasure (Art 17(3)(e)). Set once at
   *  scheduling; the processor never starts when this is non-empty. */
  threadsBlockedByHold: v.optional(v.array(v.string())),
  /** Held documents that BLOCKED the erasure (Art 17(3)(e)). Set once at
   *  scheduling alongside `threadsBlockedByHold`. */
  documentsBlockedByHold: v.optional(v.array(v.string())),
  ragDocumentsRemoved: v.optional(v.number()),
  /** Count of `documents` rows physically deleted by the subject-scope
   *  erasure helper. Should equal the number of fileIds passed to RAG
   *  delete in a clean run. */
  documentsErased: v.optional(v.number()),
  /** Count of `documents` rows the processor skipped because a hold was
   *  placed between `requestErasure` (which scheduled the run) and the
   *  processor's mid-flight re-read. Non-zero forces `status='partial'`
   *  so operators see the gap. */
  documentsSkippedByHold: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
}).index('by_organizationId_status', ['organizationId', 'status']);
