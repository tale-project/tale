/**
 * Update Document Public Mutation
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { updateDocument as updateDocumentHelper } from './update_document';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

const sourceProviderValidator = v.union(v.literal('onedrive'), v.literal('upload'));

export const updateDocument = mutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(jsonValueValidator),
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
    teamTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Get the document to check organizationId for auth
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // Verify user has access to this organization
    await getOrganizationMember(ctx, document.organizationId, {
      userId: authUser.userId ?? '',
      email: authUser.email,
      name: authUser.name,
    });

    return await updateDocumentHelper(ctx, {
      ...args,
      userId: String(authUser._id),
    });
  },
});
