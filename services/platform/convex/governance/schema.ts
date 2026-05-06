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
  /** Optional matter / case grouping (free-text for now; future:
   *  `v.id('legalMatters')`). */
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
  .index('by_target', ['organizationId', 'targetType', 'targetId']);

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
  /** SHA-256 hash of the last DELETED row's chain head. */
  lastDeletedHash: v.string(),
  /** SHA-256 hash of the first RETAINED row's previousHash field, so the
   *  retained chain can be re-anchored to this checkpoint. */
  firstRetainedPreviousHash: v.optional(v.string()),
  /** Newest `_creationTime` among deleted rows. */
  maxDeletedTimestamp: v.number(),
  /** Count of rows deleted in this batch. */
  deletedCount: v.number(),
  /** Set when bundle-3-follow-up wires the deploy-key signing. */
  signature: v.optional(v.string()),
  createdAt: v.number(),
}).index('by_organizationId_createdAt', ['organizationId', 'createdAt']);
