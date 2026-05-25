import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import {
  THREAD_FILE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_BYTES,
  THREAD_WORKSPACE_MAX_FILES,
} from './schema';

export const upsertThreadFile = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    path: v.string(),
    storageId: v.id('_storage'),
    size: v.number(),
    contentType: v.string(),
    source: v.union(
      v.literal('user_upload'),
      v.literal('agent_write'),
      v.literal('run_output'),
    ),
    renderHint: v.optional(
      v.union(
        v.literal('html'),
        v.literal('svg'),
        v.literal('mermaid'),
        v.literal('markdown'),
        v.literal('code'),
        v.literal('image'),
        v.literal('attachment'),
      ),
    ),
  },
  async handler(ctx, args) {
    if (args.size > THREAD_FILE_MAX_BYTES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'file',
        limit: THREAD_FILE_MAX_BYTES,
        size: args.size,
        message: `File exceeds the ${THREAD_FILE_MAX_BYTES}-byte per-file cap.`,
      });
    }
    const existing = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();

    // Aggregate quota check — uses the upsert delta.
    const allInThread = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) => q.eq('threadId', args.threadId))
      .collect();
    const currentBytes = allInThread.reduce((sum, f) => sum + f.size, 0);
    const replacedBytes = existing?.size ?? 0;
    const projectedBytes = currentBytes - replacedBytes + args.size;
    if (projectedBytes > THREAD_WORKSPACE_MAX_BYTES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'workspace_bytes',
        limit: THREAD_WORKSPACE_MAX_BYTES,
        current: currentBytes,
        message: `Workspace would exceed the ${THREAD_WORKSPACE_MAX_BYTES}-byte cap.`,
      });
    }
    if (existing === null && allInThread.length >= THREAD_WORKSPACE_MAX_FILES) {
      throw new ConvexError({
        code: 'WORKSPACE_QUOTA',
        scope: 'workspace_files',
        limit: THREAD_WORKSPACE_MAX_FILES,
        current: allInThread.length,
        message: `Workspace already holds ${THREAD_WORKSPACE_MAX_FILES} files. Delete some before adding more.`,
      });
    }

    const now = Date.now();
    if (existing !== null) {
      // Replace — drop the old storage blob to avoid leak.
      try {
        await ctx.storage.delete(existing.storageId);
      } catch (err) {
        console.warn('[threadFiles] storage.delete failed on replace:', err);
      }
      const patch: Record<string, unknown> = {
        storageId: args.storageId,
        size: args.size,
        contentType: args.contentType,
        source: args.source,
        updatedAt: now,
      };
      if (args.renderHint !== undefined) patch.renderHint = args.renderHint;
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, replaced: true };
    }

    const id = await ctx.db.insert('threadFiles', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      path: args.path,
      storageId: args.storageId,
      size: args.size,
      contentType: args.contentType,
      source: args.source,
      ...(args.renderHint !== undefined && { renderHint: args.renderHint }),
      createdAt: now,
      updatedAt: now,
    });
    return { id, replaced: false };
  },
});

export const deleteThreadFile = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    path: v.string(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query('threadFiles')
      .withIndex('by_thread_and_path', (q) =>
        q.eq('threadId', args.threadId).eq('path', args.path),
      )
      .first();
    if (existing === null) return { deleted: false };
    if (existing.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'CROSS_ORG_ACCESS',
        message: 'Thread file does not belong to this organization.',
      });
    }
    try {
      await ctx.storage.delete(existing.storageId);
    } catch (err) {
      console.warn('[threadFiles] storage.delete failed on remove:', err);
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});
