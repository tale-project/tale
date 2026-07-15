/**
 * DB-only mutations for the agents binding table.
 *
 * Agent configuration lives in JSON files on the filesystem (see file_actions.ts).
 * This module manages the slim DB binding record that stores Convex-internal
 * references: team assignment and knowledge files with storage IDs.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { extractExtension } from '../documents/extract_extension';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  deleteBlobInMutation,
  deleteOrgBlobInMutation,
  scheduleS3BlobDeletes,
} from '../lib/storage/blob_delete';
import { blobRefValidator, type BlobRef } from '../lib/storage/blob_ref';
import { knowledgeFileValidator } from './schema';

/**
 * Convex `_storage` is a deployment-global namespace and the `fileMetadata`
 * `by_storageId` index is not org-scoped. Public mutations that take a caller-
 * supplied `fileId` must cross-check the storageId against fileMetadata before
 * touching storage / scheduling RAG work — otherwise a member of org A can
 * supply an org B storageId and trigger writes against org B's blob/row.
 */
async function assertStorageIdInOrg(
  ctx: MutationCtx,
  organizationId: string,
  storageId: BlobRef,
): Promise<void> {
  const meta = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (meta && meta.organizationId !== organizationId) {
    // Same opaque message in both refusal paths so a caller cannot probe
    // whether a foreign storageId exists in some other org.
    throw new ConvexError('file_not_in_org');
  }
}

export const upsertBinding = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    teamId: v.optional(v.string()),
    knowledgeFiles: v.optional(v.array(knowledgeFileValidator)),
  },
  returns: v.id('agentBindings'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (args.teamId !== undefined) patch.teamId = args.teamId || undefined;
      if (args.knowledgeFiles !== undefined)
        patch.knowledgeFiles = args.knowledgeFiles;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return ctx.db.insert('agentBindings', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      teamId: args.teamId || undefined,
      knowledgeFiles: args.knowledgeFiles,
    });
  },
});

export const updateAgentBindings = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    teamId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (args.teamId !== undefined) patch.teamId = args.teamId || undefined;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
    } else {
      await ctx.db.insert('agentBindings', {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        teamId: args.teamId || undefined,
      });
    }

    return null;
  },
});

export const updateAgentSharing = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    teamIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );

    const role = member.role ?? 'member';
    if (role !== 'owner' && role !== 'admin') {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only admins can update agent sharing',
      });
    }

    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    const sharedWithTeamIds =
      args.teamIds.length > 0 ? args.teamIds : undefined;

    if (existing) {
      await ctx.db.patch(existing._id, {
        sharedWithTeamIds,
      });
    } else {
      await ctx.db.insert('agentBindings', {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        sharedWithTeamIds,
      });
    }

    return null;
  },
});

export const addKnowledgeFile = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
    fileId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    await assertStorageIdInOrg(ctx, args.organizationId, args.fileId);

    await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId: args.fileId,
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.fileSize,
      },
    );

    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    const knowledgeFiles = existing?.knowledgeFiles ?? [];
    if (knowledgeFiles.some((f) => f.fileId === args.fileId)) return null;

    const extension = extractExtension(args.fileName);
    const updatedFiles = [
      ...knowledgeFiles,
      {
        fileId: args.fileId,
        fileName: args.fileName,
        fileSize: args.fileSize,
        extension,
        ragStatus: 'queued' as const,
      },
    ];

    if (existing) {
      await ctx.db.patch(existing._id, { knowledgeFiles: updatedFiles });
    } else {
      await ctx.db.insert('agentBindings', {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        knowledgeFiles: updatedFiles,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.agents.internal_actions.indexKnowledgeFile,
      {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        fileId: args.fileId,
      },
    );

    return null;
  },
});

export const removeKnowledgeFile = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
    fileId: blobRefValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    // The fileId must be present in this org's binding. Storage + metadata
    // deletes below are global by storageId, so trusting the caller-supplied
    // fileId without proving org-ownership lets org A wipe org B's blobs.
    const inBinding = (binding?.knowledgeFiles ?? []).some(
      (f) => f.fileId === args.fileId,
    );
    if (!inBinding) throw new ConvexError('file_not_in_org');

    // Defense-in-depth: also confirm fileMetadata (if any) is org-scoped.
    await assertStorageIdInOrg(ctx, args.organizationId, args.fileId);

    if (binding) {
      const filtered = (binding.knowledgeFiles ?? []).filter(
        (f) => f.fileId !== args.fileId,
      );
      await ctx.db.patch(binding._id, { knowledgeFiles: filtered });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.agents.internal_actions.deleteKnowledgeFileFromRag,
      { organizationId: args.organizationId, fileId: args.fileId },
    );
    // Backend-aware: an `s3:` ref routes through the scheduled node lane.
    await deleteOrgBlobInMutation(
      ctx,
      args.organizationId,
      args.fileId,
      'agents.removeKnowledgeFile',
    );

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.fileId))
      .first();
    if (metadata) await ctx.db.delete(metadata._id);

    return null;
  },
});

export const cleanupAgentBinding = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (!binding) return null;

    const s3Refs: string[] = [];
    for (const file of binding.knowledgeFiles ?? []) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.internal_actions.deleteKnowledgeFileFromRag,
        { organizationId: args.organizationId, fileId: file.fileId },
      );
      // Backend-aware: `s3:` refs batch onto one scheduled node delete.
      await deleteBlobInMutation(
        ctx,
        file.fileId,
        s3Refs,
        'agents.cleanupAgentBinding',
      );

      const metadata = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', file.fileId))
        .first();
      if (metadata) await ctx.db.delete(metadata._id);
    }
    await scheduleS3BlobDeletes(ctx, args.organizationId, s3Refs);

    await ctx.db.delete(binding._id);
    return null;
  },
});
