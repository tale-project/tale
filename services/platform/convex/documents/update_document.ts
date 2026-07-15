/**
 * Update a document (for public API)
 */

import { ConvexError } from 'convex/values';
import merge from 'lodash/merge';

import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import type { BlobRef } from '../lib/storage/blob_ref';
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
    throw new ConvexError({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
    });
  }

  if (args.teamIds !== undefined && args.teamIds.length > 0) {
    if (!args.userId) {
      throw new ConvexError({
        code: 'USER_ID_REQUIRED',
        message: 'userId is required when updating teamIds',
      });
    }

    // `projectId`/`teamId` are mutually exclusive (enforced at
    // attachDocumentToProject): a project document can never be
    // team-assigned. Detach it from the project first.
    if (document.projectId != null) {
      throw new ConvexError({
        code: 'DOCUMENT_SCOPE_CONFLICT',
        message:
          'A project document cannot be assigned to teams. Detach it from the project first.',
      });
    }

    if (document.folderId) {
      const folder = await ctx.db.get(document.folderId);
      if (folder?.teamId) {
        throw new ConvexError({
          code: 'TEAM_INHERITED_FROM_FOLDER',
          message: 'Cannot change team: inherited from parent folder',
        });
      }
    }

    const userTeamIds = await getUserTeamIds(ctx, args.userId);
    const userTeamSet = new Set(userTeamIds);
    for (const id of args.teamIds) {
      if (!userTeamSet.has(id)) {
        throw new ConvexError({
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
}
