/**
 * Shared document access layer.
 *
 * Documents live in exactly one of two scopes (`projectId` and `teamId` are
 * mutually exclusive — enforced in `attachDocumentToProject`):
 *
 * - Knowledge Hub (org/team library): `projectId` unset. Team rules apply —
 *   no teams means org-wide (`hasTeamAccess`).
 * - Project files: `projectId` set. Never part of the Knowledge Hub; readable
 *   only by users with access to the owning project (`checkProjectAccess`).
 *
 * `hasTeamAccess` alone cannot tell the scopes apart — a project doc has no
 * team fields and would read as org-wide. The scope decision has one owner —
 * this module — so every hub read path (lists, pickers, agent scopes, REST,
 * WebDAV) filters through `hasKnowledgeHubDocumentAccess` (sync, list-safe)
 * or `canReadDocument` (async, resolves project access for single-doc reads).
 */

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import type { ProjectAccessResult } from '../projects/access';
import {
  NO_PROJECT_ACCESS,
  resolveProjectAccessForUser,
} from '../projects/resolve_project_access';

type DocumentScopeFields = Pick<
  Doc<'documents'>,
  'projectId' | 'teamId' | 'teamTags'
>;

/**
 * A document attached to a project. Such documents are not Knowledge Hub
 * rows: they must never surface in org/team library listings, pickers, or
 * agent knowledge scopes outside their project.
 */
export function isProjectScopedDocument(doc: DocumentScopeFields): boolean {
  return doc.projectId != null;
}

/**
 * Whether a user can see a document in Knowledge Hub surfaces (library
 * lists, `@` mention picker, agent document tools, workflow ACLs).
 *
 * Project-scoped documents are never hub-visible, regardless of the user's
 * project access — project files surface through the project's own queries
 * (`listProjectDocuments`) instead.
 */
export function hasKnowledgeHubDocumentAccess(
  doc: DocumentScopeFields,
  userTeamIds: string[] | Set<string>,
): boolean {
  if (isProjectScopedDocument(doc)) return false;
  return hasTeamAccess(doc, userTeamIds);
}

/**
 * Resolve the caller's access matrix on a project-scoped document's owning
 * project (read for viewing, edit for update/delete — the same standard as
 * `attachDocumentToProject`/`detachDocumentFromProject`). Returns null when
 * the document is not project-scoped; callers fall back to team rules then.
 * Costs a member + team lookup, so it is for single-document paths only.
 */
export async function checkProjectDocumentAccess(
  ctx: QueryCtx | MutationCtx,
  doc: Doc<'documents'>,
  args: { userId: string; organizationId: string },
): Promise<ProjectAccessResult | null> {
  if (!isProjectScopedDocument(doc) || !doc.projectId) return null;
  if (doc.organizationId !== args.organizationId) return NO_PROJECT_ACCESS;
  return resolveProjectAccessForUser(ctx, doc.projectId, args);
}

/**
 * Whether a user can read a specific document, whatever its scope.
 *
 * Knowledge Hub docs follow team access; project docs require access to the
 * owning project (org role + team membership vs the project's teams). Use on
 * single-document paths (point reads, mutation guards) — it costs a member +
 * team lookup for project docs, so it is not for per-row list filtering.
 */
export async function canReadDocument(
  ctx: QueryCtx | MutationCtx,
  doc: Doc<'documents'>,
  args: { userId: string; organizationId: string },
): Promise<boolean> {
  if (doc.organizationId !== args.organizationId) return false;

  if (!isProjectScopedDocument(doc)) {
    const userTeamIds = await getUserTeamIds(ctx, args.userId);
    return hasKnowledgeHubDocumentAccess(doc, userTeamIds);
  }

  const access = await checkProjectDocumentAccess(ctx, doc, args);
  return access?.canRead ?? false;
}
