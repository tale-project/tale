/**
 * Create a new document
 */

import type { MutationCtx } from '../_generated/server';
import type { CreateDocumentArgs, CreateDocumentResult } from './types';

import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { extractExtension } from './extract_extension';
import { teamTagsToUnifiedFields } from './team_fields';

export async function createDocument(
  ctx: MutationCtx,
  args: CreateDocumentArgs,
): Promise<CreateDocumentResult> {
  // Auto-extract extension from title if not provided
  const extension = args.extension ?? extractExtension(args.title);

  // Compute unified team fields from teamTags
  const unifiedTeamFields = teamTagsToUnifiedFields(args.teamTags);

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
    teamTags: args.teamTags,
    ...unifiedTeamFields,
    createdBy: args.createdBy,
  });

  return {
    success: true,
    documentId,
  };
}
