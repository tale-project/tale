/**
 * Shared folder access layer — the folder twin of `documents/access.ts`.
 *
 * Folders live in exactly one of two scopes (`projectId` and
 * `teamId`/`teamTags` are mutually exclusive — enforced in `createFolder`):
 *
 * - Knowledge Hub (org/team library): `projectId` unset. Team rules apply —
 *   no teams means org-wide (`hasTeamAccess`).
 * - Project folders: `projectId` set. Never part of the Knowledge Hub;
 *   visible only inside the owning project's own surfaces.
 *
 * Every hub folder read path (listings, breadcrumbs, path resolution,
 * WebDAV) must filter through `hasKnowledgeHubFolderAccess` (sync,
 * list-safe) — `hasTeamAccess` alone reads a project folder (no team
 * fields) as org-wide, the same trap `documents/access.ts` closes for
 * documents. Single-folder guards on project surfaces resolve the project
 * matrix via `checkProjectFolderAccess`.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { hasTeamAccess } from '../lib/team_access';
import type { ProjectAccessResult } from '../projects/access';
import {
  NO_PROJECT_ACCESS,
  resolveProjectAccessForUser,
} from '../projects/resolve_project_access';

// Structural (not Pick<Doc<…>>) so partial projections like breadcrumb
// items qualify — mirrors TeamScopedResource in lib/team_access.ts.
interface FolderScopeFields {
  projectId?: Id<'projects'> | null;
  teamId?: string | null;
  teamTags?: string[];
}

/**
 * A folder attached to a project. Such folders are not Knowledge Hub rows:
 * they must never surface in hub listings, breadcrumbs, path resolution, or
 * WebDAV outside their project.
 */
export function isProjectScopedFolder(folder: FolderScopeFields): boolean {
  return folder.projectId != null;
}

/**
 * Whether a user can see a folder on Knowledge Hub surfaces (documents
 * page listings, WebDAV tree, path lookups). Project-scoped folders are
 * never hub-visible, regardless of the user's project access — project
 * folders surface through the project's own queries instead.
 */
export function hasKnowledgeHubFolderAccess(
  folder: FolderScopeFields,
  userTeamIds: string[] | Set<string>,
): boolean {
  if (isProjectScopedFolder(folder)) return false;
  return hasTeamAccess(folder, userTeamIds);
}

/**
 * Resolve the caller's access matrix on a project-scoped folder's owning
 * project (read to list, edit to create/delete — the same standard as the
 * project document guards). Returns null when the folder is not
 * project-scoped; callers fall back to team rules then. Costs a member +
 * team lookup, so it is for single-folder paths only.
 */
export async function checkProjectFolderAccess(
  ctx: QueryCtx | MutationCtx,
  folder: Doc<'folders'>,
  args: { userId: string; organizationId: string },
): Promise<ProjectAccessResult | null> {
  if (!isProjectScopedFolder(folder) || !folder.projectId) return null;
  if (folder.organizationId !== args.organizationId) return NO_PROJECT_ACCESS;
  return resolveProjectAccessForUser(ctx, folder.projectId, args);
}
