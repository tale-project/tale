import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const promptScopeValidator = v.union(
  v.literal('global'),
  v.literal('team'),
  v.literal('personal'),
);

/**
 * Stored shape (matches `versionHistory` array entries on disk). Each entry
 * snapshots the full row state at that version — content + metadata — so
 * Restore re-applies everything, not just content.
 */
const promptVersionEntryStoredValidator = v.object({
  version: v.number(),
  content: v.string(),
  publishedAt: v.number(),
  publishedBy: v.string(),
  /**
   * Vestigial — older rows persisted a `publishNote`. New writes no longer
   * set this field, but reads must still validate cleanly on legacy data.
   */
  publishNote: v.optional(v.string()),
  title: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  scope: promptScopeValidator,
  teamId: v.optional(v.string()),
});

/**
 * History-API shape returned by `getPromptHistory`. Wraps the stored entry
 * with a server-resolved `publishedByName` so the UI doesn't have to do an
 * N+1 user lookup. `publishedByName` is null when the userId can't be
 * resolved (deleted user, etc.).
 */
const promptVersionEntryValidator = v.object({
  version: v.number(),
  content: v.string(),
  publishedAt: v.number(),
  publishedBy: v.string(),
  publishedByName: v.union(v.string(), v.null()),
  publishNote: v.optional(v.string()),
  title: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  scope: promptScopeValidator,
  teamId: v.optional(v.string()),
});

/**
 * Fields shared by full `getPrompt` / mutation returns and the
 * `listPrompts` list-item shape. Pulling these out keeps the two validators
 * in lock-step — the only intentional difference is that the list-item
 * shape omits `versionHistory` (use getPromptHistory for that).
 */
const promptTemplateBaseFields = {
  _id: v.id('promptTemplates'),
  _creationTime: v.number(),
  organizationId: v.string(),
  createdBy: v.string(),
  title: v.string(),
  content: v.string(),
  description: v.optional(v.string()),
  scope: promptScopeValidator,
  teamId: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  usageCount: v.number(),
  sourceMessageId: v.optional(v.string()),
  version: v.optional(v.number()),
  // Schema fields that round-trip through `ctx.db.get(...)`. Convex's return
  // validator rejects extra keys, so we must list them here even though the
  // UI doesn't read them — listPrompts uses `toListItem` which strips them,
  // but createPrompt/updatePrompt/restoreFromVersion/getPrompt return the
  // raw row.
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
} as const;

export const promptTemplateValidator = v.object({
  ...promptTemplateBaseFields,
  versionHistory: v.optional(v.array(promptVersionEntryStoredValidator)),
});

export const promptListItemValidator = v.object(promptTemplateBaseFields);

export const promptHistoryResultValidator = v.object({
  current: promptVersionEntryValidator,
  history: v.array(promptVersionEntryValidator),
  totalCount: v.number(),
});
