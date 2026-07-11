import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

export const getUserStorageUsage = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({ totalBytes: v.number() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return { totalBytes: 0 };

    let totalBytes = 0;
    for await (const meta of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('uploadedBy', authUser.userId),
      )) {
      totalBytes += meta.size;
    }
    return { totalBytes };
  },
});

export const getByDocumentId = query({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
  },
  returns: v.union(
    v.object({
      pageCount: v.optional(v.number()),
      scannedPagesDetected: v.optional(v.number()),
      visionRequired: v.optional(v.boolean()),
      ocrApplied: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_documentId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('documentId', args.documentId),
      )
      .first();
    if (!meta) return null;

    return {
      pageCount: meta.pageCount,
      scannedPagesDetected: meta.scannedPagesDetected,
      visionRequired: meta.visionRequired,
      ocrApplied: meta.ocrApplied,
    };
  },
});

export const getByStorageIds = query({
  args: {
    organizationId: v.string(),
    storageIds: v.array(v.id('_storage')),
  },
  returns: v.array(
    v.object({
      storageId: v.id('_storage'),
      documentId: v.optional(v.id('documents')),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
      ragStatus: v.optional(
        v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
          v.literal('unsupported'),
        ),
      ),
      ragError: v.optional(v.string()),
      ragProgress: v.optional(v.string()),
      pageCount: v.optional(v.number()),
      scannedPagesDetected: v.optional(v.number()),
      visionRequired: v.optional(v.boolean()),
      transcript: v.optional(v.string()),
      transcriptionStatus: v.optional(
        v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
          v.literal('skipped'),
        ),
      ),
      transcriptionError: v.optional(v.string()),
      transcriptionDurationSec: v.optional(v.number()),
      transcriptionProgress: v.optional(v.string()),
      transcriptRagStatus: v.optional(
        v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
        ),
      ),
      transcriptRagError: v.optional(v.string()),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    // RLS: only members of the named org may read its file metadata. Without
    // this, any authenticated user could pass a foreign storageId and pull
    // back another tenant's fileName/transcript/RAG state (issue #2027). The
    // soft-fail to `[]` matches the reactive-subscription contract used across
    // these queries (a non-member must not throw and white-screen the chip).
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch (error) {
      console.warn(
        '[fileMetadata.queries.getByStorageIds] org membership lookup failed:',
        error instanceof Error ? error.message : error,
      );
      return [];
    }

    const results = await Promise.all(
      args.storageIds.slice(0, 20).map(async (storageId) => {
        const meta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first();
        if (!meta) return null;
        // Per-row tenant scope: the storageId index is global, so a row whose
        // organizationId differs from the verified caller's org is filtered
        // out even though the membership check above passed for a *different*
        // org the caller does belong to.
        if (meta.organizationId !== args.organizationId) return null;
        return {
          storageId: meta.storageId,
          documentId: meta.documentId,
          fileName: meta.fileName,
          contentType: meta.contentType,
          size: meta.size,
          ragStatus: meta.ragStatus,
          ragError: meta.ragError,
          ragProgress: meta.ragProgress,
          pageCount: meta.pageCount,
          scannedPagesDetected: meta.scannedPagesDetected,
          visionRequired: meta.visionRequired,
          transcript: meta.transcript,
          transcriptionStatus: meta.transcriptionStatus,
          transcriptionError: meta.transcriptionError,
          transcriptionDurationSec: meta.transcriptionDurationSec,
          transcriptionProgress: meta.transcriptionProgress,
          transcriptRagStatus: meta.transcriptRagStatus,
          transcriptRagError: meta.transcriptRagError,
          _creationTime: meta._creationTime,
        };
      }),
    );

    return results.filter((r) => r !== null);
  },
});
