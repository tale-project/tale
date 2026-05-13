import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const promptTemplatesTable = defineTable({
  organizationId: v.string(),
  createdBy: v.string(),
  title: v.string(),
  /** The currently published content (the version visible to all consumers). */
  content: v.string(),
  description: v.optional(v.string()),
  scope: v.union(v.literal('global'), v.literal('team'), v.literal('personal')),
  teamId: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  usageCount: v.number(),
  /** @deprecated No longer used; retained as optional for backwards compatibility with existing rows. */
  isPublished: v.optional(v.boolean()),
  /** The message ID this prompt was saved from, if any. */
  sourceMessageId: v.optional(v.string()),
  /**
   * @deprecated promptTemplates are now hard-deleted on user action. These
   * two fields are retained as optional only so legacy rows that still carry
   * a `lifecycleStatus` value pass schema validation; new code never reads
   * or writes them.
   */
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),

  // --- Versioning ---
  /** Denormalized pointer to the current version number. Always equal to
   * versionHistory[0].version; kept at the row level for fast list queries. */
  version: v.optional(v.number()),

  /** Full edit log, newest first. `versionHistory[0]` IS the current
   * version — its content matches the row's top-level `content`.
   * Capped by MAX_PROMPT_VERSION_HISTORY. */
  versionHistory: v.optional(
    v.array(
      v.object({
        version: v.number(),
        content: v.string(),
        publishedAt: v.number(),
        publishedBy: v.string(),
        publishNote: v.optional(v.string()),
      }),
    ),
  ),
})
  // `by_organizationId_and_scope` doubles as the org-prefix index — Convex
  // prefix scans honor a partial column list, so callers that only filter by
  // organizationId can use this composite without a dedicated index.
  .index('by_organizationId_and_scope', ['organizationId', 'scope'])
  .index('by_org_createdBy', ['organizationId', 'createdBy']);
