import { v } from 'convex/values';

export const promptScopeValidator = v.union(
  v.literal('global'),
  v.literal('team'),
  v.literal('personal'),
);

export const promptTemplateValidator = v.object({
  _id: v.string(),
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
});
