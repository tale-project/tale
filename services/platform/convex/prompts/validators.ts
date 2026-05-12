import { v } from 'convex/values';

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
  publishNote: v.optional(v.string()),
});

export const promptTemplateValidator = v.object({
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
  lifecycleStatus: v.optional(
    v.union(
      v.literal('active'),
      v.literal('trashed'),
      v.literal('expired'),
      v.literal('deleted'),
    ),
  ),
  statusChangedAt: v.optional(v.number()),
  version: v.optional(v.number()),
  versionHistory: v.optional(v.array(promptVersionEntryValidator)),
});

/** listPrompts return shape: visible to all viewers; versionHistory stripped
 * (creator/admin can fetch via getPromptHistory). */
export const promptTemplateListItemValidator = v.object({
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
  lifecycleStatus: v.optional(
    v.union(
      v.literal('active'),
      v.literal('trashed'),
      v.literal('expired'),
      v.literal('deleted'),
    ),
  ),
  statusChangedAt: v.optional(v.number()),
  version: v.optional(v.number()),
});

export const promptHistoryResultValidator = v.object({
  current: promptVersionEntryValidator,
  history: v.array(promptVersionEntryValidator),
  totalCount: v.number(),
});
