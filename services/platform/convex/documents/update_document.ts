/**
 * Update a document (for public API)
 */

import merge from 'lodash/merge';

import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import type { BlobRef } from '../lib/storage/blob_ref';
import { assertGenericDocumentContentWritable } from './access';
import { extractExtension } from './extract_extension';
import { teamIdsToFields } from './team_fields';

export async function updateDocument(
  ctx: MutationCtx,
  args: {
    documentId: Id<'documents'>;
    title?: string;
    content?: string;
    metadata?: unknown;
    fileId?: BlobRef;
    mimeType?: string;
    extension?: string;
    sourceProvider?: string;
    externalItemId?: string;
    teamIds?: string[];
    userId?: string;
  },
): Promise<void> {
  const document = await ctx.db.get(args.documentId);
  if (!document) {
    throw new AppError({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
    });
  }

  const currentExtension =
    document.extension ?? extractExtension(document.title);
  const titleChangesExtension =
    args.title !== undefined &&
    extractExtension(args.title) !== currentExtension;

  // Controlled-record content has one attested replacement door. Frozen
  // records retain their existing state-specific error; drafts reject this
  // generic path with DOCUMENT_RECORD_REPLACEMENT_REQUIRED. Renames (`title`),
  // team and metadata edits stay allowed unless a rename changes file format.
  if (
    args.content !== undefined ||
    args.fileId !== undefined ||
    args.extension !== undefined ||
    args.mimeType !== undefined ||
    args.sourceProvider !== undefined ||
    args.externalItemId !== undefined ||
    titleChangesExtension
  ) {
    assertGenericDocumentContentWritable(document);
  }

  if (args.teamIds !== undefined && args.teamIds.length > 0) {
    if (!args.userId) {
      throw new AppError({
        code: 'USER_ID_REQUIRED',
        message: 'userId is required when updating teamIds',
      });
    }

    // `projectId`/`teamId` are mutually exclusive (enforced at
    // attachDocumentToProject): a project document can never be
    // team-assigned. Detach it from the project first.
    if (document.projectId != null) {
      throw new AppError({
        code: 'DOCUMENT_SCOPE_CONFLICT',
        message:
          'A project document cannot be assigned to teams. Detach it from the project first.',
      });
    }

    if (document.folderId) {
      const folder = await ctx.db.get(document.folderId);
      if (folder?.teamId) {
        throw new AppError({
          code: 'TEAM_INHERITED_FROM_FOLDER',
          message: 'Cannot change team: inherited from parent folder',
        });
      }
    }

    const userTeamIds = await getUserTeamIds(ctx, args.userId);
    const userTeamSet = new Set(userTeamIds);
    for (const id of args.teamIds) {
      if (!userTeamSet.has(id)) {
        throw new AppError({
          code: 'TEAM_ACCESS_DENIED',
          message: 'Cannot assign document to a team you do not belong to',
        });
      }
    }
  }

  const updateData: Record<string, unknown> = {};

  if (args.title !== undefined) updateData.title = args.title;
  if (args.content !== undefined) updateData.content = args.content;
  if (args.fileId !== undefined) updateData.fileId = args.fileId;
  if (args.mimeType !== undefined) updateData.mimeType = args.mimeType;
  if (args.sourceProvider !== undefined)
    updateData.sourceProvider = args.sourceProvider;
  if (args.externalItemId !== undefined)
    updateData.externalItemId = args.externalItemId;
  if (args.extension !== undefined) {
    updateData.extension = args.extension;
  } else if (args.title !== undefined) {
    updateData.extension = extractExtension(args.title);
  }

  if (args.metadata !== undefined) {
    const existingMetadata = document.metadata;
    if (isRecord(existingMetadata) && isRecord(args.metadata)) {
      updateData.metadata = merge({}, existingMetadata, args.metadata);
    } else {
      updateData.metadata = args.metadata;
    }
  }

  const cleanUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([, value]) => value !== undefined),
  );

  if (args.teamIds !== undefined) {
    const teamFields = teamIdsToFields(
      args.teamIds.length > 0 ? args.teamIds : undefined,
    );
    cleanUpdateData.teamId = teamFields.teamId;
    cleanUpdateData.teamTags = teamFields.teamTags;
  }

  await ctx.db.patch(args.documentId, cleanUpdateData);

  // A team change is a SCOPE change: retrieval filters on the corpus row's
  // team_ids (full list, `team_id` mirror included), so it must follow
  // without re-embedding (the content is untouched). The action re-reads the
  // row, so it stamps whatever this patch just made true.
  if (args.teamIds !== undefined && document.fileId) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.syncRagDocumentScopes,
      {
        organizationId: document.organizationId,
        documentIds: [args.documentId],
      },
    );
  }
}
