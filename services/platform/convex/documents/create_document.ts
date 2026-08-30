/**
 * Create a new document
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { MutationCtx } from '../_generated/server';
import { isProjectScopedFolder } from '../folders/access';
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
    throw new AppError({
      code: 'DOCUMENT_SCOPE_CONFLICT',
      message: 'A document cannot be both project- and team-scoped',
    });
  }

  if (args.folderId) {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.organizationId !== args.organizationId) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
    // Folder and document scopes must match: a project document may only
    // live in a folder of its own project; a hub document must never land
    // inside a project folder (opaque not-found — hub writers cannot see
    // project folders, so they cannot learn one exists).
    if (args.projectId) {
      if (folder.projectId !== args.projectId) {
        throw new AppError({
          code: 'DOCUMENT_SCOPE_CONFLICT',
          message:
            'A project document can only live in a folder of the same project',
        });
      }
    } else if (isProjectScopedFolder(folder)) {
      throw new AppError({
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
