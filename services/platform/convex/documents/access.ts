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

import { ConvexError } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import { hasProjectAccess, type ProjectAccessResult } from '../projects/access';
import {
  NO_PROJECT_ACCESS,
  resolveProjectAccessForUser,
  resolveUserAccessContext,
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

type DocumentRecordFields = Pick<Doc<'documents'>, 'record'>;

/**
 * Controlled-record content freeze (documents/records.ts owns the lifecycle).
 *
 * Content-mutating writes are allowed ONLY while a document is uncontrolled
 * or its record sits in `draft`: `in_review` is frozen so the named reviewer
 * reviews a FIXED artifact, and `approved` is immutable until
 * `openRecordRevision` opens the next draft. "Content" means the bytes and
 * their identity fields (`content`, `fileId`, `extension`, `mimeType`,
 * `contentHash`) — renames, folder moves, team/metadata edits stay allowed
 * in every state (title is identity, not content).
 */
export function isRecordContentFrozen(doc: DocumentRecordFields): boolean {
  return doc.record !== undefined && doc.record.state !== 'draft';
}

/**
 * Refuse a content-mutating write on a frozen controlled record. One guard,
 * wired into EVERY content write path (public update, internal/REST update,
 * WebDAV PUT, connector/sync upsert) — a new content writer MUST call this.
 */
export function assertRecordContentWritable(doc: DocumentRecordFields): void {
  if (!isRecordContentFrozen(doc)) return;
  throw new ConvexError({
    code: 'DOCUMENT_RECORD_FROZEN',
    message:
      doc.record?.state === 'in_review'
        ? 'This controlled record is in review and frozen. Wait for the review decision (or request changes) before editing its content.'
        : 'This controlled record is approved and immutable. Open a new revision to edit its content.',
    state: doc.record?.state,
  });
}

/**
 * Refuse trashing/deleting a protected controlled record.
 *
 * Protection follows the record's EVIDENCE, not merely its current state: a
 * record is protected while `in_review` or `approved`, AND for the rest of
 * its life once any version has been approved — an approved snapshot is the
 * signed artifact a reviewer stands behind, and it does not stop being that
 * because a later revision is being drafted. Without the second rule,
 * "open a new revision, then delete" quietly destroys the approved history
 * the whole lifecycle exists to preserve.
 *
 * Uncontrolled documents, and controlled ones still drafting their FIRST
 * (never-approved) version, trash/delete exactly as they did before.
 */
export function assertRecordTrashable(doc: DocumentRecordFields): void {
  if (doc.record === undefined) return;
  const hasApprovedHistory = doc.record.approvedVersions.length > 0;
  if (doc.record.state === 'draft' && !hasApprovedHistory) return;
  throw new ConvexError({
    code: 'DOCUMENT_RECORD_PROTECTED',
    message:
      doc.record.state === 'in_review'
        ? 'This controlled record is in review and cannot be deleted. Resolve the review first.'
        : doc.record.state === 'approved'
          ? 'This controlled record is approved and cannot be deleted. Its approved version is a retained record.'
          : 'This controlled record has an approved version in its history, which is a retained record, so it cannot be deleted.',
    state: doc.record.state,
  });
}

/**
 * A caller's document visibility for knowledge RETRIEVAL, as sets rather than
 * per-row checks — what the corpus access filter
 * (`lib/knowledge/types.ts` `KnowledgeAccessScope`) consumes.
 */
export interface ResolvedKnowledgeAccess {
  teamIds: string[];
  projectIds: string[];
  includeHub: boolean;
}

/** Fail-closed scope: no hub, no teams, no projects — a search sees nothing. */
export const NO_KNOWLEDGE_ACCESS: ResolvedKnowledgeAccess = {
  teamIds: [],
  projectIds: [],
  includeHub: false,
};

/**
 * The teams and projects whose documents a USER may retrieve — the retrieval
 * twin of the listing rules above, derived from the SAME sources so a search
 * can never surface a document the library would hide:
 *
 * - teams: the user's `teamMemberMirror` memberships (`getUserTeamIds`), plus
 *   the `org_<organizationId>` pseudo-team every member implicitly holds
 *   (parity with `getAccessibleDocumentIds`);
 * - projects: every project `hasProjectAccess` grants — org-wide projects,
 *   the user's team-shared projects, and all of them for org admins;
 * - the org hub is always visible to a member.
 *
 * Fails CLOSED ({@link NO_KNOWLEDGE_ACCESS}) when the caller's membership
 * cannot be proven, mirroring `resolveUserAccessContext`. Walks the org's
 * projects once per call — bounded by project count, for retrieval dispatches,
 * not per-row list filtering.
 */
export async function resolveKnowledgeAccessForUser(
  ctx: QueryCtx | MutationCtx,
  args: { organizationId: string; userId: string },
): Promise<ResolvedKnowledgeAccess> {
  const context = await resolveUserAccessContext(
    ctx,
    args.organizationId,
    args.userId,
  );
  if (context === null || context.role === 'disabled') {
    return { ...NO_KNOWLEDGE_ACCESS };
  }

  const teamIds = [
    ...new Set([`org_${args.organizationId}`, ...context.teamIds]),
  ];

  const projectIds: string[] = [];
  const projects = ctx.db
    .query('projects')
    .withIndex('by_organization', (q) =>
      q.eq('organizationId', args.organizationId),
    );
  for await (const project of projects) {
    if (hasProjectAccess(project, context.teamIds, context.role)) {
      projectIds.push(project._id);
    }
  }

  return { teamIds, projectIds, includeHub: true };
}
