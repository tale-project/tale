import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { promptScopeValidator } from './validators';

export const promptTemplatesTable = defineTable({
  organizationId: v.string(),
  createdBy: v.string(),
  title: v.string(),
  /** The currently published content (the version visible to all consumers). */
  content: v.string(),
  description: v.optional(v.string()),
  scope: promptScopeValidator,
  teamId: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  usageCount: v.number(),
  /** The message ID this prompt was saved from, if any. */
  sourceMessageId: v.optional(v.string()),

  // --- Versioning ---
  /** Denormalized pointer to the current version number. Always equal to
   * versionHistory[0].version; kept at the row level for fast list queries. */
  version: v.optional(v.number()),

  /** Full edit log, newest first. `versionHistory[0]` IS the current
   * version — its content + metadata match the row's top-level fields.
   * Capped by MAX_PROMPT_VERSION_HISTORY. Each entry snapshots the full
   * row state at that version (content + metadata) so Restore re-applies
   * everything, not just content. */
  versionHistory: v.optional(
    v.array(
      v.object({
        version: v.number(),
        content: v.string(),
        publishedAt: v.number(),
        publishedBy: v.string(),
        publishNote: v.optional(v.string()),
        title: v.string(),
        description: v.optional(v.string()),
        category: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        scope: promptScopeValidator,
        teamId: v.optional(v.string()),
      }),
    ),
  ),
})
  // Org-prefix newest-first listing (scope-agnostic). Convex auto-appends
  // `_creationTime` as the secondary key, so `.order('desc')` gives cursor-
  // stable newest-first paging without re-shuffling on inserts elsewhere.
  .index('by_organizationId', ['organizationId'])
  // Per-scope filtering — used for the global / team tabs.
  .index('by_organizationId_and_scope', ['organizationId', 'scope'])
  // Personal-scope filter is pushed into the index so listPrompts doesn't
  // post-filter and shrink pages to zero.
  .index('by_organizationId_and_scope_and_createdBy', [
    'organizationId',
    'scope',
    'createdBy',
  ])
  // Used by erasure / per-author lookups.
  .index('by_org_createdBy', ['organizationId', 'createdBy']);
