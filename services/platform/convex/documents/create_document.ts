/**
 * Create a new document
 */

import { ConvexError } from 'convex/values';

import type { MutationCtx } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { extractExtension } from './extract_extension';
import { teamIdsToFields } from './team_fields';
import type { CreateDocumentArgs, CreateDocumentResult } from './types';

export async function createDocument(
  ctx: MutationCtx,
  args: CreateDocumentArgs,
): Promise<CreateDocumentResult> {
  // A document carries `teamId` OR `projectId`, never both — the same
  // invariant `attachDocumentToProject` enforces (documents/schema.ts).
  if (args.projectId && args.teamId) {
    throw new ConvexError({
      code: 'DOCUMENT_SCOPE_CONFLICT',
      message: 'A document cannot be both project- and team-scoped',
    });
  }

  if (args.folderId) {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
  }

  const extension = args.extension ?? extractExtension(args.title);

  const teamFields = teamIdsToFields(args.teamId ? [args.teamId] : undefined);

  const folderPath =
    args.folderPath ??
    (args.folderId ? await buildFolderPath(ctx, args.folderId) : undefined);

  const documentId = await ctx.db.insert('documents', {
    organizationId: args.organizationId,
    title: args.title,

    content: args.content,
    fileId: args.fileId,
    mimeType: args.mimeType,
    extension,
    metadata: toConvexJsonRecord(args.metadata),
    sourceProvider: args.sourceProvider,
    externalItemId: args.externalItemId,
    contentHash: args.contentHash,
    ...teamFields,
    projectId: args.projectId,
    sourceCreatedAt: args.sourceCreatedAt,
    sourceModifiedAt: args.sourceModifiedAt,
    createdBy: args.createdBy,
    folderId: args.folderId,
    folderPath,
  });

  return {
    success: true,
    documentId,
  };
}
