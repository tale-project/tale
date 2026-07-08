import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const foldersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  parentId: v.optional(v.id('folders')),
  teamId: v.optional(v.string()),
  teamTags: v.optional(v.array(v.string())),
  // Owning project for project-scoped folders. Mutually exclusive with
  // teamId/teamTags (same invariant as documents.projectId): a folder is
  // EITHER a Knowledge Hub folder (projectId unset, team rules apply) OR a
  // project folder (projectId set, visible only inside that project). The
  // scope predicate lives in folders/access.ts.
  projectId: v.optional(v.id('projects')),
  createdBy: v.optional(v.string()),
})
  .index('by_org_parent_name', ['organizationId', 'parentId', 'name'])
  .index('by_org_project_parent_name', [
    'organizationId',
    'projectId',
    'parentId',
    'name',
  ]);
