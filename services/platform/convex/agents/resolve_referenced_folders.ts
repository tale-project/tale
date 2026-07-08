/**
 * Resolve + authorize the composer's `@`-mentioned FOLDERS synchronously at
 * send time — the folder twin of `resolve_referenced_files.ts`. A folder
 * reference expands to the RAG-indexed, blob-backed documents of its whole
 * subtree; the expansion feeds the same `pinnedFileIds` retrieval scope (and
 * the sandbox staging plan) as individual document pins, so downstream needs
 * no folder awareness.
 *
 * Scope rules mirror document pins: a Knowledge Hub folder follows team
 * access; a project folder is pinable only when the chat thread belongs to
 * that same project AND the sender can read the project. Every failure mode
 * is the same opaque KB_REF_INVALID so the error never reveals whether an
 * inaccessible folder exists.
 *
 * Bounded work: subtree walk capped by folder count and depth, expansion
 * capped at MAX_FOLDER_PIN_FILES resolved files (truncation surfaced, never
 * silent).
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isActiveDocument } from '../documents/_helpers';
import { hasKnowledgeHubFolderAccess } from '../folders/access';
import { getUserTeamIds } from '../lib/get_user_teams';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import {
  MAX_KB_REFERENCES,
  type ResolvedKbReference,
} from './resolve_referenced_files';

/** Cap on files a single turn's folder pins may expand to. */
export const MAX_FOLDER_PIN_FILES = 200;
/** Subtree walk ceiling — matches MAX_FOLDER_DEPTH's worst realistic tree. */
const MAX_SUBTREE_FOLDERS = 100;

export interface ResolvedKbFolder {
  folderId: Id<'folders'>;
  name: string;
  /** RAG-indexed files the folder contributed (post-cap). */
  fileCount: number;
}

export interface ResolvedFolderReferences {
  folders: ResolvedKbFolder[];
  files: ResolvedKbReference[];
  /** True when MAX_FOLDER_PIN_FILES cut the expansion short. */
  truncated: boolean;
}

export async function resolveReferencedFolders(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    referencedFolderIds: Id<'folders'>[];
    threadProjectId?: Id<'projects'>;
  },
): Promise<ResolvedFolderReferences> {
  if (args.referencedFolderIds.length > MAX_KB_REFERENCES) {
    throw new ConvexError({ code: 'KB_REF_INVALID' });
  }
  const userTeamIds = await getUserTeamIds(ctx, args.userId);
  // Org-wide sentinel mirrors get_accessible_document_ids.ts.
  const teamSet = new Set([`org_${args.organizationId}`, ...userTeamIds]);

  const folders: ResolvedKbFolder[] = [];
  const files: ResolvedKbReference[] = [];
  const seenFolders = new Set<string>();
  const seenFileIds = new Set<string>();
  let truncated = false;

  for (const folderId of args.referencedFolderIds) {
    if (seenFolders.has(folderId)) continue;
    seenFolders.add(folderId);

    const folder = await ctx.db.get(folderId);
    // One opaque code for every failure mode so the error doesn't reveal
    // whether an inaccessible folder exists.
    if (!folder || folder.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    if (folder.projectId != null) {
      const inSameProjectThread =
        args.threadProjectId != null &&
        folder.projectId === args.threadProjectId;
      if (!inSameProjectThread) {
        throw new ConvexError({ code: 'KB_REF_INVALID' });
      }
      const access = await resolveProjectAccessForUser(ctx, folder.projectId, {
        userId: args.userId,
        organizationId: args.organizationId,
      });
      if (!access.canRead) {
        throw new ConvexError({ code: 'KB_REF_INVALID' });
      }
    } else if (!hasKnowledgeHubFolderAccess(folder, teamSet)) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }

    const { resolved, hitCap } = await expandFolder(
      ctx,
      folder,
      seenFileIds,
      MAX_FOLDER_PIN_FILES - files.length,
    );
    files.push(...resolved);
    truncated = truncated || hitCap;
    folders.push({
      folderId: folder._id,
      name: folder.name,
      fileCount: resolved.length,
    });
  }

  return { folders, files, truncated };
}

/**
 * Breadth-first subtree expansion to RAG-indexed, blob-backed documents.
 * Children of a folder share its scope by invariant, so the access decision
 * made on the root covers the walk.
 */
async function expandFolder(
  ctx: MutationCtx,
  root: Doc<'folders'>,
  seenFileIds: Set<string>,
  budget: number,
): Promise<{ resolved: ResolvedKbReference[]; hitCap: boolean }> {
  const resolved: ResolvedKbReference[] = [];
  let hitCap = false;

  const queue: Id<'folders'>[] = [root._id];
  let visited = 0;
  while (queue.length > 0) {
    const folderId = queue.shift();
    if (!folderId) break;
    if (++visited > MAX_SUBTREE_FOLDERS) {
      hitCap = true;
      break;
    }

    const children = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q.eq('organizationId', root.organizationId).eq('parentId', folderId),
      )
      .take(MAX_SUBTREE_FOLDERS);
    for (const child of children) queue.push(child._id);

    const docs = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', root.organizationId).eq('folderId', folderId),
      );
    for await (const doc of docs) {
      if (resolved.length >= budget) {
        hitCap = true;
        break;
      }
      if (!isActiveDocument(doc)) continue;
      const fileId = doc.fileId;
      if (!fileId || seenFileIds.has(fileId)) continue;
      const fm = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
        .first();
      if (!fm || fm.ragStatus !== 'completed') continue;
      seenFileIds.add(fileId);
      resolved.push({
        documentId: doc._id,
        fileId,
        fileName: doc.title?.trim() || fm.fileName,
        fileType: doc.mimeType ?? fm.contentType,
        fileSize: fm.size,
      });
    }
    if (hitCap) break;
  }

  return { resolved, hitCap };
}
