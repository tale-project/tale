/**
 * Resolve + authorize the composer's `@`-mentioned documents synchronously so
 * an invalid reference fails the send with a client-visible ConvexError
 * instead of a mid-generation surprise. Each reference must be: same org,
 * active, scope-accessible to the sender, blob-backed, and RAG-indexed —
 * the same gate the picker query applies, re-checked server-side. Knowledge
 * Hub docs follow team access; a project-scoped doc is pinable only when the
 * chat thread belongs to that same project AND the sender can read the
 * project (a global chat cannot pin it even for a project member).
 *
 * Bounded work on the Track-B fast path: ≤ MAX_KB_REFERENCES point reads plus
 * one team lookup (and a member + project read per project-doc reference).
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isActiveDocument } from '../documents/_helpers';
import {
  canReadDocument,
  hasKnowledgeHubDocumentAccess,
  isProjectScopedDocument,
} from '../documents/access';
import { getUserTeamIds } from '../lib/get_user_teams';
import type { BlobRef } from '../lib/storage/blob_ref';

/** Hard cap on `@`-mentioned knowledge-base documents per turn. Mirrored by
 *  the composer (`MAX_KB_MENTIONS` in use-kb-mentions.ts). */
export const MAX_KB_REFERENCES = 5;

/** Branded-Id variant of `KbReferencedFile` (kb_reference_block.ts) for the
 *  scheduled-action payload. */
export interface ResolvedKbReference {
  documentId: Id<'documents'>;
  fileId: BlobRef;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export async function resolveReferencedFiles(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    referencedDocumentIds: Id<'documents'>[];
    threadProjectId?: Id<'projects'>;
  },
): Promise<ResolvedKbReference[]> {
  if (args.referencedDocumentIds.length > MAX_KB_REFERENCES) {
    throw new ConvexError({ code: 'KB_REF_INVALID' });
  }
  const userTeamIds = await getUserTeamIds(ctx, args.userId);
  // Org-wide sentinel mirrors get_accessible_document_ids.ts.
  const teamSet = new Set([`org_${args.organizationId}`, ...userTeamIds]);

  const resolved: ResolvedKbReference[] = [];
  const seen = new Set<string>();
  for (const documentId of args.referencedDocumentIds) {
    if (seen.has(documentId)) continue;
    seen.add(documentId);

    const doc = await ctx.db.get(documentId);
    // One opaque code for every failure mode so the error doesn't reveal
    // whether an inaccessible document exists.
    if (
      !doc ||
      doc.organizationId !== args.organizationId ||
      !isActiveDocument(doc)
    ) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    if (isProjectScopedDocument(doc)) {
      const inSameProjectThread =
        args.threadProjectId != null && doc.projectId === args.threadProjectId;
      if (
        !inSameProjectThread ||
        !(await canReadDocument(ctx, doc, {
          userId: args.userId,
          organizationId: args.organizationId,
        }))
      ) {
        throw new ConvexError({ code: 'KB_REF_INVALID' });
      }
    } else if (!hasKnowledgeHubDocumentAccess(doc, teamSet)) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    const fileId = doc.fileId;
    if (!fileId) {
      throw new ConvexError({ code: 'KB_REF_INVALID' });
    }
    const fm = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (!fm || fm.ragStatus !== 'completed') {
      // Access is already established at this point (org/scope/active
      // checks above passed), so naming the file here doesn't leak whether
      // an INACCESSIBLE document exists — the opaque code stays opaque for
      // every access failure above. `reason` distinguishes the one format
      // that will NEVER index (issue #2598) from the ordinary "still
      // indexing / retry" case so the composer can say something useful
      // instead of the generic opaque toast.
      throw new ConvexError({
        code: 'KB_REF_INVALID',
        reason: fm?.ragStatus === 'unsupported' ? 'unsupported' : 'not_indexed',
        fileName: doc.title?.trim() || fm?.fileName,
      });
    }
    resolved.push({
      documentId,
      fileId,
      fileName: doc.title?.trim() || fm.fileName,
      fileType: doc.mimeType ?? fm.contentType,
      fileSize: fm.size,
    });
  }
  return resolved;
}
