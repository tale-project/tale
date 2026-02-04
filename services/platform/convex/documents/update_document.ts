/**
 * Update a document (for public API)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import _ from 'lodash';
import { extractExtension } from './extract_extension';
import { getUserTeamIds } from '../lib/get_user_teams';

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
        throw new Error('Cannot assign document to a team you do not belong to');
      }
    }
  }

  const updateData: {
    title?: string;
    content?: string;
    metadata?: unknown;
    fileId?: Id<'_storage'>;
    mimeType?: string;
    extension?: string;
    sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
    externalItemId?: string;
    teamTags?: string[];
  } = {};
  if (args.title !== undefined) updateData.title = args.title;
  if (args.content !== undefined) updateData.content = args.content;
  if (args.fileId !== undefined) updateData.fileId = args.fileId;
  if (args.mimeType !== undefined) updateData.mimeType = args.mimeType;
  // Auto-extract extension from title if title is being updated but extension is not provided
  if (args.extension !== undefined) {
    updateData.extension = args.extension;
  } else if (args.title !== undefined) {
    updateData.extension = extractExtension(args.title);
  }
  if (args.sourceProvider !== undefined)
    updateData.sourceProvider = args.sourceProvider;
  if (args.externalItemId !== undefined)
    updateData.externalItemId = args.externalItemId;
  if (args.teamTags !== undefined) updateData.teamTags = args.teamTags;

  if (args.metadata !== undefined) {
    const existingMetadata = (document as { metadata?: unknown }).metadata;
    if (
      existingMetadata &&
      typeof existingMetadata === 'object' &&
      !Array.isArray(existingMetadata) &&
      args.metadata &&
      typeof args.metadata === 'object' &&
      !Array.isArray(args.metadata)
    ) {
      updateData.metadata = _.merge(
        {},
        existingMetadata as Record<string, unknown>,
        args.metadata as Record<string, unknown>,
      );
    } else {
      updateData.metadata = args.metadata;
    }
  }

   
  await ctx.db.patch(args.documentId, updateData as any);
}
