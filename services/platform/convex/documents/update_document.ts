/**
 * Update a document (for public API)
 */

import _ from 'lodash';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { isRecord } from '../../lib/utils/type-guards';
import { getUserTeamIds } from '../lib/get_user_teams';
import { extractExtension } from './extract_extension';
import { teamIdsToFields } from './team_fields';

export async function updateDocument(
  ctx: MutationCtx,
  args: {
    documentId: Id<'documents'>;
    title?: string;
    content?: string;
    metadata?: unknown;
    fileId?: Id<'_storage'>;
    mimeType?: string;
    extension?: string;
    sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
    externalItemId?: string;
    teamIds?: string[];
    userId?: string;
  },
): Promise<void> {
  const document = await ctx.db.get(args.documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  if (args.teamIds !== undefined && args.teamIds.length > 0) {
    if (!args.userId) {
      throw new Error('userId is required when updating teamIds');
    }

    if (document.folderId) {
      const folder = await ctx.db.get(document.folderId);
      if (folder?.teamId) {
        throw new Error('Cannot change team: inherited from parent folder');
      }
    }

    const userTeamIds = await getUserTeamIds(ctx, args.userId);
    const userTeamSet = new Set(userTeamIds);
    for (const id of args.teamIds) {
      if (!userTeamSet.has(id)) {
        throw new Error(
          'Cannot assign document to a team you do not belong to',
        );
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
      updateData.metadata = _.merge({}, existingMetadata, args.metadata);
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
    cleanUpdateData.sharedWithTeamIds = teamFields.sharedWithTeamIds;
  }

  await ctx.db.patch(args.documentId, cleanUpdateData);
}
