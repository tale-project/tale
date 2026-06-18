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
 * the router, @mention resolution, and the organigram all gate for free.
 *
 *  - INSTALLED      = a row exists (provisioned by autoInstall, an integration
 *                     bundle, or an explicit user/manager-agent install).
 *  - ENABLED        = `enabled !== false`; a disabled row keeps the agent's
 *                     config but removes it as a routing/mention/assignment
 *                     candidate.
 *  - `installedBy`  = 'system' | a userId | 'integration:<slug>' (provenance).
 *  - `bundledBy`    = the integration slug that installed it (cascade key;
 *                     `by_org_bundledBy` finds everything to cascade-disable).
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
  bundledBy: v.optional(v.string()),
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
