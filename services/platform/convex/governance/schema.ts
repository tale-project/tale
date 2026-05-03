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
