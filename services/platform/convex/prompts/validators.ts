import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const promptScopeValidator = v.union(
  v.literal('global'),
  v.literal('team'),
  v.literal('personal'),
);

/**
 * Stored shape (matches `versionHistory` array entries on disk). Used by
 * `promptTemplateValidator` since the row itself only stores `publishedBy`.
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
});

/**
 * History-API shape returned by `getPromptHistory`. Includes a server-resolved
 * `publishedByName` so the UI doesn't have to do an N+1 user lookup. Null when
 * the user record has been deleted or the userId can't be resolved.
 */
export const promptVersionEntryValidator = v.object({
  version: v.number(),
  content: v.string(),
  publishedAt: v.number(),
  publishedBy: v.string(),
  publishedByName: v.union(v.string(), v.null()),
  publishNote: v.optional(v.string()),
});

/**
 * Fields shared by full `getPrompt`/mutation returns and the
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
  /** @deprecated No longer used; retained as optional for backwards compatibility with existing rows. */
  isPublished: v.optional(v.boolean()),
  sourceMessageId: v.optional(v.string()),
  /**
   * @deprecated Prompt deletion is now hard-delete; these fields are kept
   * as optional only so legacy rows that still carry a `lifecycleStatus`
   * value pass validation. Drop after `purgeLegacyExpiredPrompts` runs.
   */
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
  version: v.optional(v.number()),
} as const;

export const promptTemplateValidator = v.object({
  ...promptTemplateBaseFields,
  versionHistory: v.optional(v.array(promptVersionEntryStoredValidator)),
});

/** listPrompts return shape: visible to all viewers; versionHistory stripped
 * (creator/admin can fetch via getPromptHistory). */
export const promptTemplateListItemValidator = v.object(
  promptTemplateBaseFields,
);

export const promptHistoryResultValidator = v.object({
  current: promptVersionEntryValidator,
  history: v.array(promptVersionEntryValidator),
  totalCount: v.number(),
});
