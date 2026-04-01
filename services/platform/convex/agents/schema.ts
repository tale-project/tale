import type { Infer } from 'convex/values';

import { defineTable } from 'convex/server';
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
  knowledgeFiles: v.optional(v.array(knowledgeFileValidator)),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_team', ['teamId']);
