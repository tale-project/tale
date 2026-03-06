import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const foldersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  parentId: v.optional(v.id('folders')),
  teamId: v.optional(v.string()),
  createdBy: v.optional(v.string()),
}).index('by_organizationId_and_parentId', ['organizationId', 'parentId']);
