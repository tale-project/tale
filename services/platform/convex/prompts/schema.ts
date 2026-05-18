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
  /**
   * Legacy free-form category string. Coexists with `categoryId` during the
   * `promptCategories` transition: writes prefer `categoryId`, reads fall
   * back to this string when no id is set. A future cleanup migration will
   * sweep remaining string-only rows once usage drops to near-zero.
   */
  category: v.optional(v.string()),
  /**
   * Reference to the structured `promptCategories` row. Optional during the
   * transition window — slice 2 wires lazy migration on any prompt mutation.
   */
  categoryId: v.optional(v.id('promptCategories')),
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
        /** See `promptTemplatesTable.categoryId` — same transition rules. */
        categoryId: v.optional(v.id('promptCategories')),
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

/**
 * Named categories that prompts attach to via `promptTemplates.categoryId`.
 *
 * Scope semantics:
 *  - `personal` — visible to (and manageable by) `createdBy` only.
 *  - `team`     — visible to members of `teamId`; manageable by org admins.
 *  - `global`   — visible to the whole org; manageable by org admins.
 *
 * The write-side invariant (see `assertCategoryScopeMatchesPromptScope`)
 * keeps a prompt's category scope at least as permissive as the prompt's
 * own scope, so any viewer who can read the prompt can also read the
 * category — there is no per-viewer rendering path.
 *
 * Categories with the same `name` may legitimately coexist within an org
 * (e.g. one user's personal "Drafts" and a team's "Drafts"). Uniqueness is
 * enforced within a bucket — `(organizationId, scope, teamId, createdBy)`
 * for personal; `(organizationId, scope, teamId)` for team; `(organizationId,
 * scope)` for global. `nameLower` exists so that find-or-create on the
 * lazy-migration path can do case-insensitive lookups without a full scan.
 */
export const promptCategoriesTable = defineTable({
  organizationId: v.string(),
  scope: promptScopeValidator,
  /** Required iff `scope === 'team'`. */
  teamId: v.optional(v.string()),
  createdBy: v.string(),
  name: v.string(),
  /** `name.trim().toLowerCase()` — for case-insensitive dedup scans. */
  nameLower: v.string(),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_scope', ['organizationId', 'scope'])
  .index('by_organizationId_and_scope_and_teamId', [
    'organizationId',
    'scope',
    'teamId',
  ])
  .index('by_organizationId_and_scope_and_createdBy', [
    'organizationId',
    'scope',
    'createdBy',
  ])
  .index('by_organizationId_and_nameLower', ['organizationId', 'nameLower']);
