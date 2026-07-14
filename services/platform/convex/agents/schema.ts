import { defineTable } from 'convex/server';
import type { Infer } from 'convex/values';
import { v } from 'convex/values';

export const knowledgeFileRagStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

export const knowledgeFileValidator = v.object({
  fileId: v.id('_storage'),
  fileName: v.string(),
  fileSize: v.optional(v.number()),
  extension: v.optional(v.string()),
  ragStatus: v.optional(knowledgeFileRagStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
});

export type KnowledgeFile = Infer<typeof knowledgeFileValidator>;

/**
 * Slim binding table for agent-specific Convex resources.
 *
 * Agent configuration lives in JSON files on the filesystem.
 * This table only stores Convex-internal references that cannot
 * be represented in portable JSON (storage IDs, team bindings).
 *
 * A DB record is optional — agents work without one.
 * Records are created on first use (e.g., when adding knowledge files or setting team).
 */
export const agentBindingsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  knowledgeFiles: v.optional(v.array(knowledgeFileValidator)),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_team', ['teamId']);

/**
 * Qualitative response-shaping the router may advise per message. Mirrors
 * `RouterTuningAdvice` in `auto_route_helpers.ts`. Exported so the cache
 * mutation/query validate against one definition.
 */
export const routeTuningValidator = v.object({
  style: v.optional(
    v.union(
      v.literal('concise'),
      v.literal('detailed'),
      v.literal('formal'),
      v.literal('friendly'),
    ),
  ),
  verbosity: v.optional(
    v.union(v.literal('terse'), v.literal('normal'), v.literal('verbose')),
  ),
});

/**
 * Coarse per-message reasoning SEED the router may advise — distinct from the
 * prose-level {@link routeTuningValidator}. Mirrors `RouterReasoningSeed` in
 * `auto_route_helpers.ts`. Fed to the adaptive reasoning governor as a PRIOR
 * (blended into the difficulty score), never a hard override: the online
 * controller still refines effort/temperature from observed usage, so a wrong
 * hint self-corrects within a few turns.
 */
export const routeSeedValidator = v.object({
  effort: v.optional(
    v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
  ),
  creativity: v.optional(
    v.union(v.literal('precise'), v.literal('balanced'), v.literal('creative')),
  ),
});

/**
 * "Auto" routing decision cache. Skips the router classifier when the exact
 * same normalized message has already been routed for the same candidate set.
 * `candidatesHash` folds in the roster (slug + description), so adding/removing
 * or re-describing an agent auto-invalidates stale entries. A read-side TTL +
 * a cheap cron purge bound growth — neither carries correctness, the hash does.
 */
export const autoRouteCacheTable = defineTable({
  organizationId: v.string(),
  /** Hash of the candidate roster (sorted slug+description digests). */
  candidatesHash: v.string(),
  /** Normalized, length-capped user message. */
  messageKey: v.string(),
  /** The cached decision. */
  agentSlug: v.string(),
  /** How the decision was produced. */
  source: v.union(v.literal('classified'), v.literal('override')),
  /** Advisory reply-language hint (message-derived; cached alongside the slug). */
  language: v.optional(v.string()),
  /** Advisory qualitative response shaping. */
  tuning: v.optional(routeTuningValidator),
  /** Advisory reasoning seed (governor prior). */
  seed: v.optional(routeSeedValidator),
  /** Capability slugs the router suggested enabling. */
  capabilities: v.optional(v.array(v.string())),
  hits: v.number(),
  createdAt: v.number(),
  lastUsedAt: v.number(),
})
  .index('by_org_candidates_message', [
    'organizationId',
    'candidatesHash',
    'messageKey',
  ])
  // Drives the daily TTL purge: read only the stale (oldest `createdAt`) rows
  // via the index instead of a full-table `.filter` scan.
  .index('by_createdAt', ['createdAt']);

/**
 * Agent install + enable + provenance — the runtime-state that brings agents to
 * parity with `wfInstallations`. The agent JSON file stays the source-of-truth
 * config; this row gates whether the agent is LIVE for an org. The roster read
 * (`listAgentsForOrg`) joins this table and filters to installed && enabled, so
 * the router, @mention resolution, and the org-chart reads all gate for free.
 *
 *  - INSTALLED      = a row exists (provisioned by autoInstall or an explicit
 *                     user/manager-agent install).
 *  - ENABLED        = `enabled !== false`; a disabled row keeps the agent's
 *                     config but removes it as a routing/mention/assignment
 *                     candidate.
 *  - `installedBy`  = 'system' | a userId | 'integration:<slug>' (provenance).
 *  - `bundledBy`    = RETIRED — was the integration slug that auto-installed
 *                     this row, for the disconnect cascade to find via
 *                     `by_org_bundledBy`. No longer written or read.
 *  - `disabledReason` = why a disabled row is off — `integration_disabled`
 *                     (cascade; re-enabled only by reconnect) vs `user`
 *                     (explicit; never resurrected by a cascade).
 */
export const agentInstallationsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  installedAt: v.number(),
  installedBy: v.string(),
  contentHash: v.string(),
  enabled: v.boolean(),
  disabledReason: v.optional(
    v.union(v.literal('integration_disabled'), v.literal('user')),
  ),
  // RETIRED — the integration-bundles auto-install/cascade mechanism that
  // wrote and read this field was removed (see convex/integrations/cascade.ts,
  // credential_mutations.ts). No longer written or read in live code; the
  // field (and `by_org_bundledBy` below) stay until the migration draining
  // existing rows ships, then drop both.
  bundledBy: v.optional(v.string()),
  // Set iff this agent belongs to an installed app (composite slug
  // `<automationSlug>/<name>`). The recorded, authoritative owner — stamped at app
  // install — used by the global app marker and the delete/disable guards.
  // Orthogonal to `bundledBy` (the integration-cascade key): an app agent
  // carries `automationSlug` and never `bundledBy`. Absent for global agents.
  automationSlug: v.optional(v.string()),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'agentSlug'])
  .index('by_org_bundledBy', ['organizationId', 'bundledBy']);

/**
 * One row per (org, agent) the autoInstall provisioner has handled. Existence
 * means "this org got its auto-install once" — an org that later uninstalls or
 * disables the agent is never re-provisioned behind its back (opt-outs stick
 * across reseeds and upgrades). Mirrors `wfDefaultProvisionsTable`.
 */
export const agentDefaultProvisionsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  contentHash: v.string(),
  provisionedAt: v.number(),
}).index('by_org_slug', ['organizationId', 'agentSlug']);

/**
 * Per-agent env/secrets — one row per (organizationId, agentSlug, key). Plain
 * vars carry `value`; secrets carry an `encryptedValue` (JWE) and are
 * write-only. Resolved + injected at the agent's external-run claim. CRUD in
 * `agents/agent_env.ts`; encryption in `agents/agent_env_actions.ts`.
 */
export const agentEnvTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  /** Env var name (validated `^[A-Za-z_][A-Za-z0-9_]*$`). */
  key: v.string(),
  isSecret: v.boolean(),
  /** Plaintext value for non-secret vars; omitted for secrets. */
  value: v.optional(v.string()),
  /** JWE ciphertext for secrets; omitted for non-secret vars. */
  encryptedValue: v.optional(v.string()),
  /** Low-leak edge preview of a secret (e.g. `sk-••••xyz`) for the editor;
   *  computed at write time, omitted for non-secret vars. */
  maskedPreview: v.optional(v.string()),
  /** When set, this row is a TOKEN-SOURCE BINDING, not a literal value: `key` is
   *  the env var the rotation engine injects a broker-fetched token under, and
   *  this is the `token-sources` config slug to draw from. value/encryptedValue/
   *  maskedPreview are omitted for such rows; isSecret is true (the injected
   *  token is a secret). */
  tokenSourceSlug: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_org_agent_key', ['organizationId', 'agentSlug', 'key']);
