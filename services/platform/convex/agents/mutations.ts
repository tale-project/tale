/**
 * DB-only mutations for the agents binding table.
 *
 * Agent configuration lives in JSON files on the filesystem (see file_actions.ts).
 * This module manages the slim DB binding record that stores Convex-internal
 * references: team assignment and knowledge files with storage IDs.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { extractExtension } from '../documents/extract_extension';
import { knowledgeFileValidator } from './schema';

export const upsertBinding = internalMutation({
  args: {
    organizationId: v.string(),
    agentFileName: v.string(),
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
          .eq('agentFileName', args.agentFileName),
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
      agentFileName: args.agentFileName,
      teamId: args.teamId || undefined,
      knowledgeFiles: args.knowledgeFiles,
    });
  },
});

export const updateAgentBindings = mutation({
  args: {
    organizationId: v.string(),
    agentFileName: v.string(),
    teamId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentFileName', args.agentFileName),
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
        agentFileName: args.agentFileName,
        teamId: args.teamId || undefined,
      });
    }

    return null;
  },
});

export const addKnowledgeFile = mutation({
  args: {
    organizationId: v.string(),
    agentFileName: v.string(),
    fileId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.fileSize,
    });

    const existing = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentFileName', args.agentFileName),
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
        agentFileName: args.agentFileName,
        knowledgeFiles: updatedFiles,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.agents.internal_actions.indexKnowledgeFile,
      {
        organizationId: args.organizationId,
        agentFileName: args.agentFileName,
        fileId: args.fileId,
      },
    );

    return null;
  },
});

export const removeKnowledgeFile = mutation({
  args: {
    organizationId: v.string(),
    agentFileName: v.string(),
    fileId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentFileName', args.agentFileName),
      )
      .first();

    if (binding) {
      const filtered = (binding.knowledgeFiles ?? []).filter(
        (f) => f.fileId !== args.fileId,
      );
      await ctx.db.patch(binding._id, { knowledgeFiles: filtered });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.agents.internal_actions.deleteKnowledgeFileFromRag,
      { fileId: args.fileId },
    );
    await ctx.storage.delete(args.fileId);

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
    agentFileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentFileName', args.agentFileName),
      )
      .first();

    if (!binding) return null;

    for (const file of binding.knowledgeFiles ?? []) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.internal_actions.deleteKnowledgeFileFromRag,
        { fileId: file.fileId },
      );
      await ctx.storage.delete(file.fileId);

      const metadata = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', file.fileId))
        .first();
      if (metadata) await ctx.db.delete(metadata._id);
    }

    await ctx.db.delete(binding._id);
    return null;
  },
});
