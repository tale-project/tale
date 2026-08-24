import { v } from 'convex/values';

export const googleDriveItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  isFolder: v.boolean(),
  mimeType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  webUrl: v.optional(v.string()),
});

export const importItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  relativePath: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  selectedParentId: v.optional(v.string()),
  selectedParentName: v.optional(v.string()),
  selectedParentPath: v.optional(v.string()),
});

export const importFileResultValidator = v.object({
  fileId: v.string(),
  fileName: v.string(),
  status: v.union(
    v.literal('success'),
    v.literal('skipped'),
    v.literal('error'),
  ),
  documentId: v.optional(v.id('documents')),
  error: v.optional(v.string()),
});
