import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
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

  /** Soft-delete state used by the retention pipeline (see
   * governance/retention_cleanup.cleanupPromptTemplates). User-initiated
   * `deletePrompt` is hard-delete and bypasses this field; only the
   * scheduled retention cron writes 'trashed' / 'expired'. Rows missing
   * this field are treated as `'active'`. */
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  /** Timestamp of the last `lifecycleStatus` transition; used by the
   * grace-period check in the retention cleanup pass. */
  statusChangedAt: v.optional(v.number()),
  /** @deprecated draft/publish was removed when versioning landed (every
   * save is an instant publish). Kept as optional for legacy-row read
   * tolerance — do not write to it. */
  isPublished: v.optional(v.boolean()),

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
  .index('by_org_createdBy', ['organizationId', 'createdBy'])
  // Used by the retention pipeline (listGraceExpiredPromptTemplates) to
  // scan rows that have already been soft-deleted and are awaiting
  // grace-period hard-purge.
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ]);
