import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const promptScopeValidator = v.union(
  v.literal('global'),
  v.literal('team'),
  v.literal('personal'),
);

export const promptVersionEntryValidator = v.object({
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
  isPublished: v.boolean(),
  sourceMessageId: v.optional(v.string()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
  version: v.optional(v.number()),
} as const;

export const promptTemplateValidator = v.object({
  ...promptTemplateBaseFields,
  versionHistory: v.optional(v.array(promptVersionEntryValidator)),
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
