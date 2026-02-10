/**
 * Update a document (for public API)
 */

import _ from 'lodash';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { isRecord } from '../../lib/utils/type-guards';
import { getUserTeamIds } from '../lib/get_user_teams';
import { extractExtension } from './extract_extension';
import { teamTagsToUnifiedFields } from './team_fields';

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
    teamTags?: string[];
    userId?: string;
  },
): Promise<void> {
  const document = await ctx.db.get(args.documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  // Validate teamTags: user can only assign document to teams they belong to
  if (args.teamTags !== undefined) {
    if (!args.userId) {
      throw new Error('userId is required when updating teamTags');
    }
    const userTeamIds = await getUserTeamIds(ctx, args.userId);
    const userTeamSet = new Set(userTeamIds);
    for (const tag of args.teamTags) {
      if (!userTeamSet.has(tag)) {
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
  if (args.teamTags !== undefined) {
    updateData.teamTags = args.teamTags;
    const unifiedTeamFields = teamTagsToUnifiedFields(args.teamTags);
    updateData.teamId = unifiedTeamFields.teamId;
    updateData.sharedWithTeamIds = unifiedTeamFields.sharedWithTeamIds;
  }

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
    Object.entries(updateData).filter(([_, value]) => value !== undefined),
  );

  await ctx.db.patch(args.documentId, cleanUpdateData);
}
